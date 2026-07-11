-- Shared command file reader for SonarLinkBridge.

local CommandBridge = {}

local COMMANDS_FILE = nil
local LAST_SIZE = 0
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

function CommandBridge.hasNewCommands(force)
  local filePath = CommandBridge.getCommandsFile()
  if not filePath then return false end

  local probe = io.open(filePath, "r")
  if not probe then return false end
  local size = probe:seek("end")
  probe:close()

  if not force and size == LAST_SIZE then
    return false
  end

  LAST_SIZE = size
  return true
end

return CommandBridge
