-- Third person camera feature for SonarLinkBridge.
-- Toggle, distance slider, vehicle offset, and safe smooth transitions.

local UEHelpers = require("UEHelpers")

local ThirdPersonCamera = {}

local VERSION = "1.9.7"

local THIRD_PERSON_ENABLED = false
local CAMERA_DISTANCE_PERCENT = 50
local LAST_APPLIED_PERCENT = nil
local LAST_APPLIED_IN_VEHICLE = nil
local WAS_IN_VEHICLE = false
local SMOOTH_TOKEN = 0
local suspendedUntil = 0
local SUSPEND_AFTER_RESTART_S = 4.0

local SMOOTH_STEP_MS = 50
local SMOOTH_STEPS = 11

local function suspendFor(seconds)
  local untilAt = os.clock() + seconds
  if untilAt > suspendedUntil then
    suspendedUntil = untilAt
  end
end

function ThirdPersonCamera.isSuspended()
  return os.clock() < suspendedUntil
end

local function sendConsoleCommand(cmd)
  local lib = UEHelpers.GetKismetSystemLibrary()
  local pc = UEHelpers.GetPlayerController()
  if not lib or not pc then return false end

  local ok, valid = pcall(function() return pc:IsValid() end)
  if not ok or not valid then return false end

  local sent = false
  pcall(function()
    lib:ExecuteConsoleCommand(pc, cmd, nil)
    sent = true
  end)
  return sent
end

local function percentToCameraOffset(percent)
  local value = tonumber(percent) or 50
  value = math.max(1, math.min(99, value))

  local minOffset = 50.0
  local defaultOffset = 250.0
  local maxOffset = 1500.0

  if value <= 50 then
    return minOffset + ((value - 1) / 49) * (defaultOffset - minOffset)
  end

  return defaultOffset + ((value - 50) / 49) * (maxOffset - defaultOffset)
end

local VEHICLE_CAMERA_OFFSET = percentToCameraOffset(81) - percentToCameraOffset(50)

local function smoothstep(t)
  return t * t * (3 - 2 * t)
end

function ThirdPersonCamera.isPlayerReady()
  local pc = UEHelpers.GetPlayerController()
  if not pc or not pc:IsValid() then return false end

  local okLocal, isLocal = pcall(function()
    return pc.IsLocalPlayerController and pc:IsLocalPlayerController()
  end)
  if not okLocal or not isLocal then return false end

  local pawn = nil
  pcall(function()
    pawn = pc.Pawn or pc.Character
  end)
  return pawn ~= nil and pawn:IsValid()
end

local function getPlayerContext()
  local pc = UEHelpers.GetPlayerController()
  if not pc or not pc:IsValid() then return nil end

  local pawn = nil
  pcall(function()
    pawn = pc.Pawn or pc.Character
  end)
  if not pawn or not pawn:IsValid() then return nil end

  local className = nil
  pcall(function()
    className = pawn:GetClass():GetFName():ToString()
  end)

  return {
    pc = pc,
    pawn = pawn,
    className = className,
  }
end

local function isPlayerOnFootFromContext(ctx)
  if not ctx or not ctx.className then return false end
  if ctx.className:find("MainMenu") then return false end
  return ctx.className:find("Character") ~= nil
end

local function isPlayerInVehicleFromContext(ctx)
  if not ctx or not ctx.className then return false end
  if ctx.className:find("MainMenu") then return false end
  return not isPlayerOnFootFromContext(ctx)
end

local function readThirdPersonFromGame()
  local pc = UEHelpers.GetPlayerController()
  if not pc or not pc:IsValid() then return nil end

  local perspective = nil
  pcall(function()
    perspective = pc.CurrentPerspective
  end)
  if type(perspective) ~= "number" then return nil end
  return perspective ~= 0
end

local function readCameraOffset(pc)
  if not pc or not pc:IsValid() then return nil end

  local value = nil
  pcall(function()
    value = pc.CameraOffset
  end)
  if type(value) == "number" then return value end

  return nil
end

local function writeCameraOffset(pc, offset)
  if not pc or not pc:IsValid() then return false end

  pcall(function()
    pc.CameraOffset = offset
  end)

  return true
end

local function resolveCameraOffset(percent, inVehicle)
  local offset = percentToCameraOffset(percent)
  if inVehicle then
    offset = offset + VEHICLE_CAMERA_OFFSET
  end
  return offset
end

local function cancelSmoothCamera()
  SMOOTH_TOKEN = SMOOTH_TOKEN + 1
end

local function finishDistanceApply(percent, inVehicle, targetOffset)
  LAST_APPLIED_PERCENT = percent
  LAST_APPLIED_IN_VEHICLE = inVehicle
  print(string.format(
    "[SonarLinkBridge:ThirdPerson] distance %d -> CameraOffset %.1f%s",
    percent,
    targetOffset,
    inVehicle and " (vehicle)" or ""
  ))
end

local function applyCameraDistanceInstant(percent)
  if not THIRD_PERSON_ENABLED or ThirdPersonCamera.isSuspended() then return false end

  local ctx = getPlayerContext()
  if not ctx then return false end

  cancelSmoothCamera()

  percent = tonumber(percent) or CAMERA_DISTANCE_PERCENT
  percent = math.max(1, math.min(99, math.floor(percent + 0.5)))
  local inVehicle = isPlayerInVehicleFromContext(ctx)
  local targetOffset = resolveCameraOffset(percent, inVehicle)

  writeCameraOffset(ctx.pc, targetOffset)
  CAMERA_DISTANCE_PERCENT = percent
  finishDistanceApply(percent, inVehicle, targetOffset)
  return true
end

local function applyCameraDistanceSmooth(percent)
  if not THIRD_PERSON_ENABLED or ThirdPersonCamera.isSuspended() then return false end

  local ctx = getPlayerContext()
  if not ctx then return false end

  percent = tonumber(percent) or CAMERA_DISTANCE_PERCENT
  percent = math.max(1, math.min(99, math.floor(percent + 0.5)))
  local inVehicle = isPlayerInVehicleFromContext(ctx)
  local targetOffset = resolveCameraOffset(percent, inVehicle)

  local startOffset = readCameraOffset(ctx.pc)
  if startOffset == nil then
    return applyCameraDistanceInstant(percent)
  end

  if math.abs(startOffset - targetOffset) < 3.0 then
    return applyCameraDistanceInstant(percent)
  end

  cancelSmoothCamera()
  local token = SMOOTH_TOKEN
  CAMERA_DISTANCE_PERCENT = percent

  for step = 1, SMOOTH_STEPS do
    ExecuteInGameThreadWithDelay(SMOOTH_STEP_MS * step, function()
      if token ~= SMOOTH_TOKEN then return end
      if not THIRD_PERSON_ENABLED then return end

      local stepCtx = getPlayerContext()
      if not stepCtx then return end

      local t = smoothstep(step / SMOOTH_STEPS)
      local value = startOffset + (targetOffset - startOffset) * t
      writeCameraOffset(stepCtx.pc, value)

      if step == SMOOTH_STEPS then
        finishDistanceApply(percent, inVehicle, targetOffset)
      end
    end)
  end

  return true
end

local function applyCameraDistance(percent, smooth)
  if smooth then
    return applyCameraDistanceSmooth(percent)
  end
  return applyCameraDistanceInstant(percent)
end

local function applyThirdPerson(desired, force)
  if not ThirdPersonCamera.isPlayerReady() then return end
  if ThirdPersonCamera.isSuspended() then return end

  if force then
    local actual = readThirdPersonFromGame()
    if actual ~= nil then
      THIRD_PERSON_ENABLED = actual
    end
  end

  if desired == THIRD_PERSON_ENABLED then
    return
  end

  if sendConsoleCommand("ThirdPerson") then
    THIRD_PERSON_ENABLED = desired
    LAST_APPLIED_PERCENT = nil
    LAST_APPLIED_IN_VEHICLE = nil
    cancelSmoothCamera()
    print(string.format(
      "[SonarLinkBridge:ThirdPerson] %s",
      desired and "enabled" or "disabled"
    ))
    if desired then
      applyCameraDistanceSmooth(CAMERA_DISTANCE_PERCENT)
    end
  end
end

function ThirdPersonCamera.shouldWatchVehicle()
  return THIRD_PERSON_ENABLED
end

function ThirdPersonCamera.checkVehicleStateChange()
  if not THIRD_PERSON_ENABLED or ThirdPersonCamera.isSuspended() then return false end

  local ctx = getPlayerContext()
  if not ctx then return false end

  local inVehicle = isPlayerInVehicleFromContext(ctx)
  if inVehicle == WAS_IN_VEHICLE then return false end

  WAS_IN_VEHICLE = inVehicle
  LAST_APPLIED_PERCENT = nil
  LAST_APPLIED_IN_VEHICLE = nil
  applyCameraDistanceSmooth(CAMERA_DISTANCE_PERCENT)

  return true
end

function ThirdPersonCamera.handleThirdPersonLine(line, force)
  if not line then return end
  if not ThirdPersonCamera.isPlayerReady() then return end
  local enabled = line:find('"enabled"%s*:%s*true') ~= nil
  local shouldForce = force or line:find('"force"%s*:%s*true') ~= nil
  applyThirdPerson(enabled, shouldForce)
end

function ThirdPersonCamera.handleDistanceLine(line)
  if not line then return end
  local percent = tonumber(line:match('"percent"%s*:%s*(%d+)'))
  if not percent then return end

  local smooth = line:find('"smooth"%s*:%s*true') ~= nil
  CAMERA_DISTANCE_PERCENT = percent
  if THIRD_PERSON_ENABLED then
    applyCameraDistance(percent, smooth)
  end
end

function ThirdPersonCamera.onPawnRestart()
  suspendFor(SUSPEND_AFTER_RESTART_S)
  cancelSmoothCamera()
  LAST_APPLIED_PERCENT = nil
  LAST_APPLIED_IN_VEHICLE = nil

  local ctx = getPlayerContext()
  if ctx then
    WAS_IN_VEHICLE = isPlayerInVehicleFromContext(ctx)
  end
end

function ThirdPersonCamera.init()
  print("[SonarLinkBridge:ThirdPerson] loaded v" .. VERSION)
end

return ThirdPersonCamera
