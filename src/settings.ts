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
export interface HoneywellPlatformConfig extends PlatformConfig {
  ipaddress?: IPAddress;
  password?: string;
  disablePlugin?: boolean;
  options?: options | Record<string, never>;
}

export type options = {
  refreshRate?: number;
  pushRate?: number;
  hide_device: string[];
};

export interface AxiosRequestConfig {
  params?: Record<string, unknown>;
  headers?: any;
}