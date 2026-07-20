-- Live player position telemetry for SonarLink minimap.
-- Position and forward vector are read on separate game thread ticks (~1 s full update).

local UEHelpers = require("UEHelpers")

local MapTelemetry = {}

local VERSION = "1.9.28"
local TELEMETRY_FILE = nil
local MOD_DIR = debug.getinfo(1, "S").source:match("@?(.*[\\/])") or ""
local SUSPEND_AFTER_RESTART_S = 4.0
local SUSPEND_AFTER_CLASS_CHANGE_S = 2.0
local INACTIVE_WRITE_INTERVAL_S = 1.0
local CLASS_REFRESH_INTERVAL_S = 2.5
local WRITE_EPSILON = 0.5
local HEADING_EPSILON = 0.01

local suspendedUntil = 0
local lastInactiveWriteAt = 0
local lastInactiveReason = nil
local lastClassRefreshAt = 0
local lastClassName = nil
local wasActive = false
local restartId = 0

local pendingPosition = nil
local pendingForwardX = 1.0
local pendingForwardY = 0.0

local lastWritten = {
  x = nil,
  y = nil,
  forwardX = nil,
  forwardY = nil,
}

local BLOCKED_CLASS_PATTERNS = {
  "MainMenu",
  "Movie",
  "Cinematic",
  "Credits",
  "Loading",
}

local function getPathsJsonPath()
  if MOD_DIR:find("Scripts", 1, true) then
    return MOD_DIR:gsub("Scripts[\\/]?$", "") .. "sonarlink.paths.json"
  end
  return MOD_DIR .. "sonarlink.paths.json"
end

local function loadTelemetryFileFromPathsJson(filePath)
  local f = io.open(filePath, "r")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  if not content or content == "" then return nil end

  local telemetryFile = content:match('"mapTelemetryFile"%s*:%s*"([^"]+)"')
  if telemetryFile and telemetryFile ~= "" then
    return telemetryFile:gsub("\\\\", "\\")
  end

  local dataRoot = content:match('"dataRoot"%s*:%s*"([^"]+)"')
  if dataRoot and dataRoot ~= "" then
    dataRoot = dataRoot:gsub("\\\\", "\\")
    return dataRoot .. "\\map-telemetry.json"
  end

  return nil
end

function MapTelemetry.getTelemetryFile()
  local fromMod = loadTelemetryFileFromPathsJson(getPathsJsonPath())
  if fromMod then
    TELEMETRY_FILE = fromMod
    return TELEMETRY_FILE
  end

  if TELEMETRY_FILE then return TELEMETRY_FILE end

  local appData = os.getenv("LOCALAPPDATA")
  if appData and appData ~= "" then
    local legacyPaths = appData .. "\\SonarLink\\paths.json"
    local fromLegacy = loadTelemetryFileFromPathsJson(legacyPaths)
    if fromLegacy then
      TELEMETRY_FILE = fromLegacy
      return TELEMETRY_FILE
    end

    TELEMETRY_FILE = appData .. "\\SonarLink\\map-telemetry.json"
    return TELEMETRY_FILE
  end

  return nil
end

function MapTelemetry.isSuspended()
  return os.clock() < suspendedUntil
end

local function isObjectValid(obj)
  if not obj then return false end
  local ok, valid = pcall(function()
    return obj:IsValid()
  end)
  return ok and valid
end

local function isPlayableClass(className)
  if not className or className == "" then return false end
  for _, pattern in ipairs(BLOCKED_CLASS_PATTERNS) do
    if className:find(pattern) then return false end
  end
  return true
end

local function suspendFor(seconds)
  local untilAt = os.clock() + seconds
  if untilAt > suspendedUntil then
    suspendedUntil = untilAt
  end
end

local function readClassName(pawn)
  local className = nil
  pcall(function()
    local classObj = pawn:GetClass()
    if classObj and isObjectValid(classObj) then
      className = classObj:GetFName():ToString()
    end
  end)
  return className
end

local function readAxisPair(vec)
  if not vec then return nil end

  local x = nil
  local y = nil
  local ok = pcall(function()
    x = vec.X
    y = vec.Y
  end)
  if not ok or type(x) ~= "number" or type(y) ~= "number" then
    return nil
  end

  return { x = x, y = y }
end

-- Write full JSON via temp file then rename to avoid Node reading a truncated file.
local function writeFileAtomic(filePath, content)
  local tmpPath = filePath .. ".tmp"
  local f = io.open(tmpPath, "wb")
  if not f then return false end
  f:write(content)
  f:close()

  pcall(function()
    os.remove(filePath)
  end)

  local renamed = os.rename(tmpPath, filePath)
  if renamed then
    return true
  end

  -- Fallback: direct write if rename failed on this platform.
  local f2 = io.open(filePath, "wb")
  if not f2 then
    pcall(function()
      os.remove(tmpPath)
    end)
    return false
  end
  f2:write(content)
  f2:close()
  pcall(function()
    os.remove(tmpPath)
  end)
  return true
end

local function resolvePlayablePawn()
  local pc = UEHelpers.GetPlayerController()
  if not isObjectValid(pc) then return nil end

  local isLocal = false
  local okLocal = pcall(function()
    isLocal = pc.IsLocalPlayerController and pc:IsLocalPlayerController()
  end)
  if not okLocal or not isLocal then return nil end

  local pawn = nil
  pcall(function()
    pawn = pc.Pawn or pc.Character
  end)
  if not isObjectValid(pawn) then return nil end

  local now = os.clock()
  local needRefresh = (lastClassName == nil) or ((now - lastClassRefreshAt) >= CLASS_REFRESH_INTERVAL_S)
  local className = lastClassName

  if needRefresh then
    className = readClassName(pawn)
    lastClassRefreshAt = now

    -- Always store the refreshed name (including blocked). Never keep a stale playable cache.
    if not isPlayableClass(className) then
      lastClassName = className
      pendingPosition = nil
      return nil
    end

    if className ~= lastClassName then
      if lastClassName ~= nil and isPlayableClass(lastClassName) then
        -- Playable -> playable swap: clear stale coords and go inactive for the suspend window.
        pendingPosition = nil
        suspendFor(SUSPEND_AFTER_CLASS_CHANGE_S)
        MapTelemetry.markInactive("suspend")
      end
      lastClassName = className
    else
      lastClassName = className
    end
  elseif not isPlayableClass(className) then
    pendingPosition = nil
    return nil
  end

  return pawn
end

local function resolvePawnForForward()
  local pc = UEHelpers.GetPlayerController()
  if not isObjectValid(pc) then return nil end

  local isLocal = false
  local okLocal = pcall(function()
    isLocal = pc.IsLocalPlayerController and pc:IsLocalPlayerController()
  end)
  if not okLocal or not isLocal then return nil end

  local pawn = nil
  pcall(function()
    pawn = pc.Pawn or pc.Character
  end)
  if not isObjectValid(pawn) then return nil end
  if not lastClassName or not isPlayableClass(lastClassName) then return nil end

  return pawn
end

function MapTelemetry.onWorldRestart()
  restartId = restartId + 1
end

function MapTelemetry.onPawnRestart()
  lastClassName = nil
  lastClassRefreshAt = 0
  pendingPosition = nil
  suspendFor(SUSPEND_AFTER_RESTART_S)
  wasActive = false
  MapTelemetry.markInactive("suspend")
end

local function writeInactiveTelemetry(reason)
  local filePath = MapTelemetry.getTelemetryFile()
  if not filePath then return end

  local inactiveReason = reason or "menu"
  local content = string.format(
    '{"active":false,"reason":"%s","restartId":%d,"ts":%d}',
    inactiveReason,
    restartId,
    os.time() * 1000
  )

  local ok = pcall(function()
    if not writeFileAtomic(filePath, content) then
      error("telemetry inactive write failed")
    end
  end)

  if ok then
    lastWritten.x = nil
    lastWritten.y = nil
    lastWritten.forwardX = nil
    lastWritten.forwardY = nil
    pendingPosition = nil
  end
end

function MapTelemetry.markInactive(reason)
  local inactiveReason = reason or "menu"
  local now = os.clock()
  if wasActive == false
    and lastInactiveReason == inactiveReason
    and (now - lastInactiveWriteAt) < INACTIVE_WRITE_INTERVAL_S then
    return
  end

  lastInactiveWriteAt = now
  lastInactiveReason = inactiveReason
  wasActive = false
  pendingPosition = nil
  writeInactiveTelemetry(inactiveReason)
end

local function shouldWriteSample(sample)
  if lastWritten.x == nil then return true end

  local dx = sample.x - lastWritten.x
  local dy = sample.y - lastWritten.y
  if (dx * dx + dy * dy) >= (WRITE_EPSILON * WRITE_EPSILON) then
    return true
  end

  local dfx = sample.forwardX - (lastWritten.forwardX or 0)
  local dfy = sample.forwardY - (lastWritten.forwardY or 0)
  return (dfx * dfx + dfy * dfy) >= (HEADING_EPSILON * HEADING_EPSILON)
end

local function writeTelemetry(sample)
  if not shouldWriteSample(sample) then
    return
  end

  local filePath = MapTelemetry.getTelemetryFile()
  if not filePath then return end

  local content = string.format(
    '{"active":true,"x":%.2f,"y":%.2f,"forwardX":%.6f,"forwardY":%.6f,"restartId":%d,"ts":%d}',
    sample.x,
    sample.y,
    sample.forwardX,
    sample.forwardY,
    restartId,
    os.time() * 1000
  )

  local ok = pcall(function()
    if not writeFileAtomic(filePath, content) then
      error("telemetry write failed")
    end
  end)

  if not ok then return end

  lastWritten.x = sample.x
  lastWritten.y = sample.y
  lastWritten.forwardX = sample.forwardX
  lastWritten.forwardY = sample.forwardY
  wasActive = true
  lastInactiveReason = nil
end

function MapTelemetry.runPositionPhase()
  if MapTelemetry.isSuspended() then
    return
  end

  ExecuteInGameThread(function()
    pcall(function()
      local pawn = resolvePlayablePawn()
      if not pawn then
        pendingPosition = nil
        MapTelemetry.markInactive()
        return
      end

      local location = nil
      pcall(function()
        location = pawn:K2_GetActorLocation()
      end)

      local position = readAxisPair(location)
      if not position then
        pendingPosition = nil
        MapTelemetry.markInactive()
        return
      end

      pendingPosition = position
    end)
  end)
end

function MapTelemetry.runForwardPhase()
  if MapTelemetry.isSuspended() then
    return
  end

  if not pendingPosition then
    return
  end

  ExecuteInGameThread(function()
    pcall(function()
      local position = pendingPosition
      if not position then return end

      local pawn = resolvePawnForForward()
      if not pawn then
        pendingPosition = nil
        MapTelemetry.markInactive()
        return
      end

      local forward = nil
      pcall(function()
        forward = pawn:GetActorForwardVector()
      end)

      local facing = readAxisPair(forward)
      if facing then
        pendingForwardX = facing.x
        pendingForwardY = facing.y
      end

      writeTelemetry({
        x = position.x,
        y = position.y,
        forwardX = pendingForwardX,
        forwardY = pendingForwardY,
      })
    end)
  end)
end

function MapTelemetry.init()
  print("[SonarLinkBridge:MapTelemetry] loaded v" .. VERSION .. " (split position/forward ticks)")
end

return MapTelemetry
