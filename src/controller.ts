import ScreenLogic from 'node-screenlogic'
import { Logger } from 'homebridge'

interface ControllerOptions {
  log: Logger
  ip_address?: string
  port?: number
  username?: string
  password?: string
}

/**
 * config options:
 * 1. UDP broadcast to find unit:
 *   config = {}
 * 2. find unit by static IP address.
 *   config = {
 *     ip_address: "n.n.n.n",
 *     username: "Pentair: XX-XX-XX" // optional
 *   }
 * 3. login via Pentrair remote gateway
 *   config = {
 *     username: "Pentair: XX-XX-XX",
 *     password: "..."
 *   }
 */
export class Controller {
  static readonly SPA_CIRCUIT_ID = 500
  static readonly POOL_CIRCUIT_ID = 505

  static readonly HEAT_MODE_OFF = 0
  static readonly HEAT_MODE_SOLAR = 1
  static readonly HEAT_MODE_SOLAR_PREFERRED = 2
  static readonly HEAT_MODE_HEAT_PUMP = 3
  static readonly HEAT_MODE_UNCHANGED = 4

  private readonly log: Logger
  private readonly ip_address?: string
  private readonly port?: number
  private readonly username?: string
  private readonly password?: string

  constructor(settings: ControllerOptions) {
    this.log = settings.log
    this.ip_address = settings.ip_address
    this.port = settings.port
    this.username = settings.username
    this.password = settings.password
  }

  async getPoolConfig(): Promise<PoolConfig> {
    const connection = await this._getConnection()
    try {
      await this._login(connection)
      return await this._getPoolConfig(connection)
    } finally {
      connection.close()
    }
  }

  async getPoolStatus(): Promise<PoolStatus> {
    const connection = await this._getConnection()
    try {
      await this._login(connection)
      return await this._getPoolStatus(connection)
    } finally {
      connection.close()
    }
  }

  async setCircuitState(circuitId: number, circuitState: boolean): Promise<void> {
    const connection = await this._getConnection()
    try {
      await this._login(connection)
      return await this._setCircuitState(connection, circuitId, circuitState)
    } finally {
      connection.close()
    }
  }

  async setHeatPoint(bodyType: number, heatPoint: number): Promise<void> {
    const connection = await this._getConnection()
    try {
      await this._login(connection)
      return await this._setHeatPoint(connection, bodyType, heatPoint)
    } finally {
      connection.close()
    }
  }

  async setHeatMode(bodyType: number, heatMode: number): Promise<void> {
    const connection = await this._getConnection()
    try {
      await this._login(connection)
      return await this._setHeatMode(connection, bodyType, heatMode)
    } finally {
      connection.close()
    }
  }

  async _getPoolConfig(connection: ScreenLogic.UnitConnection): Promise<PoolConfig> {
    let softwareVersion = ''
    return new Promise((resolve, reject) => {
      connection
        .once('version', version => {
          softwareVersion = version.version
          connection.getControllerConfig()
        })
        .once('controllerConfig', poolConfig => {
          this.log.debug('controllerConfig', poolConfig)
          resolve(new PoolConfig(connection.gatewayName, softwareVersion, poolConfig))
        })
        .on('error', err => {
          reject(err)
        })
      connection.getVersion()
    })
  }

  async _setCircuitState(
    connection: ScreenLogic.UnitConnection,
    circuitId: number,
    circuitState: boolean,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      connection
        .once('circuitStateChanged', () => {
          resolve()
        })
        .once('badParameter', () => {
          reject(new ControllerError('bad parameter passed to set command'))
        })
        .on('error', err => {
          reject(err)
        })
      connection.setCircuitState(0, circuitId, circuitState ? 1 : 0)
    })
  }

  async _setHeatPoint(
    connection: ScreenLogic.UnitConnection,
    bodyType: number,
    heatPoint: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      connection
        .once('setPointChanged', () => {
          resolve()
        })
        .once('badParameter', () => {
          reject(new ControllerError('bad parameter passed to set command'))
        })
        .on('error', err => {
          reject(err)
        })
      connection.setSetPoint(0, bodyType, heatPoint)
    })
  }

  async _setHeatMode(
    connection: ScreenLogic.UnitConnection,
    bodyType: number,
    heatMode: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      connection
        .once('heatModeChanged', () => {
          resolve()
        })
        .once('badParameter', () => {
          reject(new ControllerError('bad parameter passed to set command'))
        })
        .on('error', err => {
          reject(err)
        })
      connection.setHeatMode(0, bodyType, heatMode)
    })
  }

  async _getPoolStatus(connection: ScreenLogic.UnitConnection): Promise<PoolStatus> {
    return new Promise((resolve, reject) => {
      connection
        .once('poolStatus', status => {
          this.log.debug('poolStatus', status)
          resolve(new PoolStatus(status))
        })
        .on('error', err => {
          reject(err)
        })
      connection.getPoolStatus()
    })
  }

  async _login(connection: ScreenLogic.UnitConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      connection
        .once('loggedIn', () => {
          resolve()
        })
        .once('loginFailed', () => {
          reject(new ControllerError('unable to login'))
        })
        .on('error', err => {
          reject(err)
        })
      connection.connect()
    })
  }

  async _getConnection(): Promise<ScreenLogic.UnitConnection> {
    if (this.ip_address) {
      return this._getConnectionByIPAddress()
    } else if (this.username && this.password) {
      return this._getConnectionByRemoteLogin()
    } else {
      return this._getConnectionByBroadcast()
    }
  }

  /** get a connection by udp broadcast */
  async _getConnectionByBroadcast(): Promise<ScreenLogic.UnitConnection> {
    return new Promise((resolve, reject) => {
      const finder = new ScreenLogic.FindUnits()
      finder
        .on('serverFound', server => {
          finder.close()
          const connection = new ScreenLogic.UnitConnection(server)
          connection.gatewayName = server.gatewayName
          resolve(connection)
        })
        .on('error', err => {
          reject(err)
        })
      finder.search()
    })
  }

  /** get a connection by IP address */
  async _getConnectionByIPAddress(): Promise<ScreenLogic.UnitConnection> {
    return new Promise((resolve, _reject) => {
      const connection = new ScreenLogic.UnitConnection(
        this.port || 80,
        this.ip_address,
        this.password,
      )
      connection.gatewayName = this.username ?? 'Pentair: XX-XX-XX'
      resolve(connection)
    })
  }

  /** find a unit by remote login */
  async _getConnectionByRemoteLogin(): Promise<ScreenLogic.UnitConnection> {
    return new Promise((resolve, reject) => {
      const remote = new ScreenLogic.RemoteLogin(this.username)
      remote
        .on('gatewayFound', unit => {
          remote.close()
          if (unit && unit.gatewayFound) {
            const connection = new ScreenLogic.UnitConnection(unit.port, unit.ipAddr, this.password)
            connection.gatewayName = this.username
            resolve(connection)
          } else {
            reject(new ControllerError('no remote unit found'))
          }
        })
        .on('error', (err: Error) => {
          reject(err)
        })
      remote.connect()
    })
  }
}

export class ControllerError extends Error {}

export class PoolCircuit {
  constructor(public readonly id: number, public readonly name: string) {}
}

export class PoolConfig {
  public readonly gatewayName: string
  public readonly deviceId: string

  public readonly softwareVersion: string
  public readonly isCelsius: boolean
  public readonly poolMinSetPoint: number
  public readonly poolMaxSetPoint: number
  public readonly spaMinSetPoint: number
  public readonly spaMaxSetPoint: number
  public readonly hasSpa: boolean
  public readonly hasPool: boolean
  public circuits: PoolCircuit[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(gatewayName: string, softwareVersion: string, config: any) {
    this.gatewayName = gatewayName
    this.deviceId = gatewayName.replace('Pentair: ', '')

    this.softwareVersion = softwareVersion
    this.isCelsius = config.degC
    this.poolMinSetPoint = config.minSetPoint[0] ?? 0
    this.poolMaxSetPoint = config.maxSetPoint[0] ?? 0
    this.spaMinSetPoint = config.minSetPoint[1] ?? 0
    this.spaMaxSetPoint = config.maxSetPoint[1] ?? 0
    this.hasSpa = false
    this.hasPool = false
    this.circuits = []
    for (const circuit of config.bodyArray) {
      const poolCircuit = new PoolCircuit(circuit.circuitId, circuit.name)
      this.circuits.push(poolCircuit)
      if (poolCircuit.id === Controller.POOL_CIRCUIT_ID) {
        this.hasPool = true
      } else if (poolCircuit.id === Controller.SPA_CIRCUIT_ID) {
        this.hasSpa = true
      }
    }
  }
}

export class PoolStatus {
  public readonly circuitState = new Map<number, number>()

  public readonly hasPool: boolean
  public readonly poolTemperature: number
  public readonly poolSetPoint: number
  public readonly isPoolActive: boolean
  public readonly isPoolHeating: boolean
  public readonly poolHeatMode: number

  public readonly hasSpa: boolean
  public readonly spaTemperature: number
  public readonly spaSetPoint: number
  public readonly isSpaActive: boolean
  public readonly isSpaHeating: boolean
  public readonly spaHeatMode: number

  public readonly airTemperature: number

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(status: any) {
    // save circuit state
    this.circuitState = new Map()
    for (const circuit of status.circuitArray) {
      this.circuitState.set(circuit.id, circuit.state)
    }

    this.hasPool = this.circuitState.get(Controller.POOL_CIRCUIT_ID) !== undefined
    this.hasSpa = this.circuitState.get(Controller.SPA_CIRCUIT_ID) !== undefined

    this.poolTemperature = status.currentTemp[0]
    this.poolSetPoint = status.setPoint[0]
    this.isPoolActive = this.hasPool && status.isPoolActive()
    this.isPoolHeating = this.hasPool && status.heatStatus[0] !== 0
    this.poolHeatMode = status.heatMode[0]

    this.spaTemperature = status.currentTemp[1]
    this.spaSetPoint = status.setPoint[1]
    this.isSpaActive = this.hasSpa && status.isSpaActive()
    this.isSpaHeating = this.hasSpa && status.heatStatus[1] !== 0
    this.spaHeatMode = status.heatMode[1]

    this.airTemperature = status.airTemp
  }
}
