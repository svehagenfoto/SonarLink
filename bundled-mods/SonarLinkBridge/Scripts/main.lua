-- SonarLinkBridge entry point.
-- Routes SonarLink commands to feature modules.

local CommandBridge = require("commandBridge")
local ThirdPersonCamera = require("thirdPersonCamera")
local MapTelemetry = require("mapTelemetry")

local BRIDGE_VERSION = "1.9.26"
local MAIN_POLL_MS = 500
local RESTART_SETTLE_DELAY_MS = 1500
local RESTART_COMMAND_DELAY_MS = 6000

local mapTelemetryTick = 0

local function applyLatestCommands(force)
  if not ThirdPersonCamera.isPlayerReady() then return end
  if ThirdPersonCamera.isSuspended() then return end

  ThirdPersonCamera.checkVehicleStateChange()

  local commands = CommandBridge.readLatestCommands()
  if commands.thirdPerson then
    ThirdPersonCamera.handleThirdPersonLine(commands.thirdPerson, force)
  end
  if commands.thirdPersonDistance then
    ThirdPersonCamera.handleDistanceLine(commands.thirdPersonDistance)
  end
end

local function runVehicleCheckOnGameThread()
  ExecuteInGameThread(function()
    pcall(function()
      if ThirdPersonCamera.isPlayerReady() then
        ThirdPersonCamera.checkVehicleStateChange()
      end
    end)
  end)
end

local function runCommandPass(hasNew, force)
  ExecuteInGameThread(function()
    pcall(function()
      if not ThirdPersonCamera.isPlayerReady() then return end
      if hasNew then
        applyLatestCommands(force)
      else
        ThirdPersonCamera.checkVehicleStateChange()
      end
    end)
  end)
end

local function pollBridge(force)
  local hasNew = CommandBridge.hasNewCommands(force)

  if hasNew then
    runCommandPass(true, force)
    return
  end

  if ThirdPersonCamera.isPlayerReady() and ThirdPersonCamera.shouldWatchVehicle() then
    runVehicleCheckOnGameThread()
  end
end

RegisterHook("/Script/Engine.PlayerController:ClientRestart", function()
  pcall(function()
    MapTelemetry.onWorldRestart()
  end)

  ExecuteInGameThreadWithDelay(RESTART_SETTLE_DELAY_MS, function()
    pcall(function()
      ThirdPersonCamera.onPawnRestart()
      MapTelemetry.onPawnRestart()
    end)
  end)

  ExecuteInGameThreadWithDelay(RESTART_COMMAND_DELAY_MS, function()
    ExecuteInGameThread(function()
      pcall(function()
        if ThirdPersonCamera.isPlayerReady() and not ThirdPersonCamera.isSuspended() then
          applyLatestCommands(true)
        end
      end)
    end)
  end)
end)

ThirdPersonCamera.init()
MapTelemetry.init()

LoopAsync(MAIN_POLL_MS, function()
  mapTelemetryTick = mapTelemetryTick + 1
  pollBridge(false)
  if mapTelemetryTick % 2 == 1 then
    MapTelemetry.runPositionPhase()
  else
    MapTelemetry.runForwardPhase()
  end
  return false
end)

print("[SonarLinkBridge] loaded v" .. BRIDGE_VERSION)
