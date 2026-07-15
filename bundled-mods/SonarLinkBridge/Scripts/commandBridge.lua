-- Shared command file reader for SonarLinkBridge.

local CommandBridge = {}

local COMMANDS_FILE = nil
local LAST_SIGNATURE = nil
local MOD_DIR = debug.getinfo(1, "S").source:match("@?(.*[\\/])") or ""

local function getPathsJsonPath()
  if MOD_DIR:find("Scripts", 1, true) then
    return MOD_DIR:gsub("Scripts[\\/]?$", "") .. "sonarlink.paths.json"
  end
  return MOD_DIR .. "sonarlink.paths.json"
end

local function loadCommandsFileFromPathsJson(filePath)
  local f = io.open(filePath, "r")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  if not content or content == "" then return nil end

  local commandsFile = content:match('"commandsFile"%s*:%s*"([^"]+)"')
  if commandsFile and commandsFile ~= "" then
    return commandsFile:gsub("\\\\", "\\")
  end

  return nil
end

function CommandBridge.getCommandsFile()
  local fromMod = loadCommandsFileFromPathsJson(getPathsJsonPath())
  if fromMod then
    COMMANDS_FILE = fromMod
    return COMMANDS_FILE
  end

  if COMMANDS_FILE then return COMMANDS_FILE end

  local appData = os.getenv("LOCALAPPDATA")
  if appData and appData ~= "" then
    local legacyPaths = appData .. "\\SonarLink\\paths.json"
    local fromLegacy = loadCommandsFileFromPathsJson(legacyPaths)
    if fromLegacy then
      COMMANDS_FILE = fromLegacy
      return COMMANDS_FILE
    end

    COMMANDS_FILE = appData .. "\\SonarLink\\commands.jsonl"
    return COMMANDS_FILE
  end

  return nil
end

function CommandBridge.readLatestCommands()
  local filePath = CommandBridge.getCommandsFile()
  if not filePath then return {} end

  local f = io.open(filePath, "r")
  if not f then return {} end

  local latest = {}

  for line in f:lines() do
    if line and line ~= "" then
      if line:find('"cmd"%s*:%s*"third%-person%-distance"') then
        latest.thirdPersonDistance = line
      elseif line:find('"cmd"%s*:%s*"third%-person"') then
        latest.thirdPerson = line
      end
    end
  end

  f:close()
  return latest
end

local function signaturePartThirdPerson(line)
  if not line then return nil end
  local enabled = line:find('"enabled"%s*:%s*true') and "1" or "0"
  local force = line:find('"force"%s*:%s*true') and "1" or "0"
  return "tp:" .. enabled .. ":" .. force
end

local function signaturePartDistance(line)
  if not line then return nil end
  local percent = line:match('"percent"%s*:%s*(%d+)') or "?"
  local smooth = line:find('"smooth"%s*:%s*true') and "1" or "0"
  return "dist:" .. percent .. ":" .. smooth
end

local function buildCommandSignature(commands)
  local parts = {}

  local thirdPerson = signaturePartThirdPerson(commands.thirdPerson)
  if thirdPerson then
    parts[#parts + 1] = thirdPerson
  end

  local distance = signaturePartDistance(commands.thirdPersonDistance)
  if distance then
    parts[#parts + 1] = distance
  end

  if #parts == 0 then
    return ""
  end

  return table.concat(parts, "|")
end

function CommandBridge.hasNewCommands(force)
  if force then
    return true
  end

  local commands = CommandBridge.readLatestCommands()
  local signature = buildCommandSignature(commands)

  if LAST_SIGNATURE ~= nil and signature == LAST_SIGNATURE then
    return false
  end

  LAST_SIGNATURE = signature
  return true
end

return CommandBridge
