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
  disablePlugin?: boolean;
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
  showStopIrrigationSwitch?: boolean;
  showZoneValve?: boolean;
  refreshRate?: number;
  showRequestResponse?: boolean;
  logging?: string;
};

export type options = {
  refreshRate?: number;
  pushRate?: number;
  hide_device: string[];
  logging?: string;
};
