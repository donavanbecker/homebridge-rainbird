/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker) & mantorok1 (https://github.com/mantorok1). All rights reserved.
 *
 * settings.ts: homebridge-rainbird.
 */
import { IPAddress, PlatformConfig } from 'homebridge';
/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'RainBird';

/**
 * This must match the name of your plugin as defined the package.json
 */
export const PLUGIN_NAME = 'homebridge-rainbird';

//Config
export interface RainbirdPlatformConfig extends PlatformConfig {
  devices?: Array<DevicesConfig>;
  options?: options | Record<string, never>;
}

export type DevicesConfig = {
  ipaddress?: IPAddress;
  password?: string;
  showRainSensor?: boolean;
  showValveSensor?: boolean;
  showProgramASwitch?: boolean;
  showProgramBSwitch?: boolean;
  showProgramCSwitch?: boolean;
  showProgramDSwitch?: boolean;
  showStopIrrigationSwitch?: boolean;
  minValueRemainingDuration?: number;
  maxValueRemainingDuration?: number;
  syncTime?: boolean;
  showRequestResponse?: boolean;
  showZoneValve?: boolean;
  includeZones?: string,
  showDelayIrrigationSwitch?: boolean;
  irrigationDelay?: number;
  external: boolean;
  firmware?: number;
  refreshRate?: number;
  logging?: string;
  delete?: boolean;
};

export type options = {
  refreshRate?: number;
  pushRate?: number;
  hide_device?: string[];
  logging?: string;
};
