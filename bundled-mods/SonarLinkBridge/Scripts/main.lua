-- SonarLinkBridge entry point.
-- Routes SonarLink commands to feature modules.

local CommandBridge = require("commandBridge")
local ThirdPersonCamera = require("thirdPersonCamera")

local BRIDGE_VERSION = "1.9.6"

local function applyLatestCommands(force)
  if not ThirdPersonCamera.isPlayerReady() then return end

  ThirdPersonCamera.checkVehicleStateChange()

  local commands = CommandBridge.readLatestCommands()
  if commands.thirdPerson then
    ThirdPersonCamera.handleThirdPersonLine(commands.thirdPerson, force)
  end
  if commands.thirdPersonDistance then
    ThirdPersonCamera.handleDistanceLine(commands.thirdPersonDistance)
  end
end

local function pollCommands(force)
  local hasNew = CommandBridge.hasNewCommands(force)

  if not hasNew then
    if ThirdPersonCamera.isPlayerReady() then
      ExecuteInGameThread(function()
        pcall(function()
          ThirdPersonCamera.checkVehicleStateChange()
        end)
      end)
    end
    return
  end

  if not ThirdPersonCamera.isPlayerReady() then return end

  ExecuteInGameThread(function()
    pcall(function()
      applyLatestCommands(force)
    end)
  end)
end

RegisterHook("/Script/Engine.PlayerController:ClientRestart", function()
  ExecuteInGameThreadWithDelay(1500, function()
    ThirdPersonCamera.onPawnRestart()
    if ThirdPersonCamera.isPlayerReady() then
      pcall(function()
        applyLatestCommands(true)
      end)
    end
  end)
end)

ThirdPersonCamera.init()

LoopAsync(500, function()
  pollCommands(false)
  return false
end)

print("[SonarLinkBridge] loaded v" .. BRIDGE_VERSION)
