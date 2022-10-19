import axios = require('axios');
import crypto = require('crypto');
import encoder = require('text-encoder');
import aesjs = require('aes-js');
import cq = require('concurrent-queue');
import superStringify from 'super-stringify';

import { Logger } from 'homebridge';
import { Request } from './requests/Request';
import { Response } from './responses/Response';
import { ModelAndVersionRequest } from './requests/ModelAndVersionRequest';
import { ModelAndVersionResponse } from './responses/ModelAndVersionResponse';
import { AvailableZonesResponse } from './responses/AvailableZonesResponse';
import { AvailableZonesRequest } from './requests/AvailableZonesRequest';
import { SerialNumberResponse } from './responses/SerialNumberResponse';
import { SerialNumberRequest } from './requests/SerialNumberRequest';
import { AcknowledgedResponse } from './responses/AcknowledgedResponse';
import { NotAcknowledgedResponse } from './responses/NotAcknowledgedResponse';
import { RunProgramRequest } from './requests/RunProgramRequest';
import { RunZoneRequest } from './requests/RunZoneRequest';
import { StopIrrigationRequest } from './requests/StopIrrigationRequest';
import { ControllerStateResponse } from './responses/ControllerStateResponse';
import { ControllerStateRequest } from './requests/ControllerStateRequest';
import { ControllerDateRequest } from './requests/ControllerDateRequest';
import { ControllerDateResponse } from './responses/ControllerDateResponse';
import { ControllerTimeRequest } from './requests/ControllerTimeRequest';
import { ControllerTimeResponse } from './responses/ControllerTimeResponse';
import { IrrigationStateRequest } from './requests/IrrigationStateRequest';
import { IrrigationStateResponse } from './responses/IrrigationStateResponse';
import { RainSensorStateRequest } from './requests/RainSensorStateRequest';
import { RainSensorStateResponse } from './responses/RainSensorStateResponse';
import { CurrentZoneRequest } from './requests/CurrentZoneRequest';
import { CurrentZoneResponse } from './responses/CurrentZoneResponse';
import { CurrentZoneStateRequest } from './requests/CurrentZoneStateRequest';
import { CurrentZoneStateResponse } from './responses/CurrentZoneStateResponse';
import { AdvanceZoneRequest } from './requests/AdvanceZoneRequest';

type RainBirdRequest = {
  type: Request,
  retry: boolean,
  postDelay: number
}

export class RainBirdClient {
  private readonly RETRY_DELAY = 60;

  private requestQueue = cq()
    .limit({ concurrency: 1 })
    .process(this.sendRequest.bind(this));

  constructor(
    private readonly address: string,
    private readonly password: string,
    private readonly log: Logger,
    private readonly showRequestResponse: boolean) {
  }

  public async getModelAndVersion(): Promise<ModelAndVersionResponse> {
    const request: RainBirdRequest = {
      type: new ModelAndVersionRequest(),
      retry: true,
      postDelay: 0,
    };
    return await this.requestQueue(request) as ModelAndVersionResponse;
  }

  public async getAvailableZones(): Promise<AvailableZonesResponse> {
    const request: RainBirdRequest = {
      type: new AvailableZonesRequest(),
      retry: true,
      postDelay: 0,
    };
    return await this.requestQueue(request) as AvailableZonesResponse;
  }

  public async getSerialNumber(): Promise<SerialNumberResponse> {
    const request: RainBirdRequest = {
      type: new SerialNumberRequest(),
      retry: true,
      postDelay: 0,
    };
    return await this.requestQueue(request) as SerialNumberResponse;
  }

  public async runProgram(program: number): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request: RainBirdRequest = {
      type: new RunProgramRequest(program),
      retry: true,
      postDelay: 1,
    };
    const response = await this.requestQueue(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async runZone(zone: number, duration: number): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request: RainBirdRequest = {
      type: new RunZoneRequest(zone, Math.round(duration / 60)),
      retry: true,
      postDelay: 1,
    };
    const response = await this.requestQueue(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async advanceZone(): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request: RainBirdRequest = {
      type: new AdvanceZoneRequest(),
      retry: true,
      postDelay: 1,
    };
    const response = await this.requestQueue(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async stopIrrigation(): Promise<AcknowledgedResponse | NotAcknowledgedResponse> {
    const request: RainBirdRequest = {
      type: new StopIrrigationRequest(),
      retry: true,
      postDelay: 1,
    };
    const response = await this.requestQueue(request);
    return response!.type === 0
      ? response as NotAcknowledgedResponse
      : response as AcknowledgedResponse;
  }

  public async getControllerState(): Promise<ControllerStateResponse> {
    const request: RainBirdRequest = {
      type: new ControllerStateRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as ControllerStateResponse;
  }

  public async getControllerDate(): Promise<ControllerDateResponse> {
    const request: RainBirdRequest = {
      type: new ControllerDateRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as ControllerDateResponse;
  }

  public async getControllerTime(): Promise<ControllerTimeResponse> {
    const request: RainBirdRequest = {
      type: new ControllerTimeRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as ControllerTimeResponse;
  }

  public async getIrrigationState(): Promise<IrrigationStateResponse> {
    const request: RainBirdRequest = {
      type: new IrrigationStateRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as IrrigationStateResponse;
  }

  public async getRainSensorState(): Promise<RainSensorStateResponse> {
    const request: RainBirdRequest = {
      type: new RainSensorStateRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as RainSensorStateResponse;
  }

  public async getCurrentZone(): Promise<CurrentZoneResponse> {
    const request: RainBirdRequest = {
      type: new CurrentZoneRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as CurrentZoneResponse;
  }

  public async getCurrentZoneState(): Promise<CurrentZoneStateResponse> {
    const request: RainBirdRequest = {
      type: new CurrentZoneStateRequest(),
      retry: false,
      postDelay: 0,
    };
    return await this.requestQueue(request) as CurrentZoneStateResponse;
  }

  private async sendRequest(request: RainBirdRequest): Promise<Response | undefined> {
    if (this.showRequestResponse) {
      this.log.warn(`[${this.address}] Request:  ${request.type}`);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const url = `http://${this.address}/stick`;
        const data: Buffer = this.encrypt(request.type);
        const config = this.createRequestConfig();

        const resp = await axios.default.post(url, data, config);

        if (!resp.statusText || resp.status !== 200) {
          throw new Error(`Invalid Response [Status: ${resp.status}, Text: ${resp.statusText}]`);
        }

        const response = this.getResponse(resp.data as Buffer);
        await this.delay(request.postDelay);

        return response;
      } catch (error) {
        this.log.warn(`RainBird controller request failed. [${error}]`);
        if (!request.retry) {
          break;
        }
        this.log.warn(`Will retry in ${this.RETRY_DELAY} seconds`);
        await this.delay(this.RETRY_DELAY);
      }
    }
  }

  private getResponse(encryptedResponse: Buffer): Response | undefined {
    // eslint-disable-next-line no-control-regex
    const decryptedResponse = JSON.parse(this.decrypt(encryptedResponse).replace(/[\x10\x0A\x00]/g, ''));

    if (!decryptedResponse) {
      this.log.error('No response received');
      return;
    }
    if (decryptedResponse.error) {
      this.log.error(
        `Received error from Rainbird controller ${decryptedResponse.error.code}: ${decryptedResponse.error.message}`);
      return;
    }
    if (!decryptedResponse.result) {
      this.log.error('Invalid response received');
      return;
    }
    const data = Buffer.from(decryptedResponse.result.data, 'hex');

    let response: Response | undefined = undefined;
    switch (data[0]) {
      case 0x00:
        response = new NotAcknowledgedResponse(data);
        break;
      case 0x01:
        response = new AcknowledgedResponse(data);
        break;
      case 0x82:
        response = new ModelAndVersionResponse(data);
        break;
      case 0x83:
        response = new AvailableZonesResponse(data);
        break;
      case 0x85:
        response = new SerialNumberResponse(data);
        break;
      case 0x90:
        response = new ControllerTimeResponse(data);
        break;
      case 0x92:
        response = new ControllerDateResponse(data);
        break;
      case 0xBB:
        response = new CurrentZoneStateResponse(data);
        break;
      case 0xBE:
        response = new RainSensorStateResponse(data);
        break;
      case 0xBF:
        response = new CurrentZoneResponse(data);
        break;
      case 0xC8:
        response = new IrrigationStateResponse(data);
        break;
      case 0xCC:
        response = new ControllerStateResponse(data);
        break;
    }

    if (this.showRequestResponse) {
      this.log.warn(`[${this.address}] Response: ${response ?? 'Unknown'}`);
    }

    return response;
  }

  private encrypt(request: Request): Buffer {
    const formattedRequest = this.formatRequest(request);
    const
      passwordHash = crypto.createHash('sha256').update(this.toBytes(this.password)).digest(),
      randomBytes = crypto.randomBytes(16),
      packedRequest = this.toBytes(this.addPadding(`${formattedRequest}\x00\x10`)),
      hashedRequest = crypto.createHash('sha256').update(this.toBytes(formattedRequest)).digest(),
      easEncryptor = new aesjs.ModeOfOperation.cbc(passwordHash, randomBytes),
      encryptedRequest = Buffer.from(easEncryptor.encrypt(packedRequest));
    return Buffer.concat([hashedRequest, randomBytes, encryptedRequest]);
  }

  private decrypt(data: Buffer): string {
    const
      passwordHash = crypto.createHash('sha256').update(this.toBytes(this.password)).digest().slice(0, 32),
      randomBytes = data.slice(32, 48),
      encryptedBody = data.slice(48, data.length),
      aesDecryptor = new aesjs.ModeOfOperation.cbc(passwordHash, randomBytes);
    return new encoder.TextDecoder().decode(aesDecryptor.decrypt(encryptedBody));
  }

  private formatRequest(request: Request) {
    const data: Buffer = request.toBuffer();
    return superStringify({
      'id': 9,
      'jsonrpc': '2.0',
      'method': 'tunnelSip',
      'params': {
        'data': data.toString('hex'),
        'length': data.length,
      },
    });
  }

  private createRequestConfig(): axios.AxiosRequestConfig {
    return {
      responseType: 'arraybuffer',
      headers: {
        'Accept-Language': 'en',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'RainBird/2.0 CFNetwork/811.5.4 Darwin/16.7.0',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Content-Type': 'application/octet-stream',
      },
    };
  }

  private toBytes(str: string) {
    return new encoder.TextEncoder('utf-8').encode(str);
  }

  private addPadding(data: string): string {
    const BLOCK_SIZE = 16;
    const dataLength = data.length;
    const charsToAdd = (dataLength + BLOCK_SIZE) - (dataLength % BLOCK_SIZE) - dataLength;
    const pad_string = Array(charsToAdd + 1).join('\x10');
    return [data, pad_string].join('');
  }

  private async delay(sec: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve('');
      }, sec * 1000);
    });
  }
}