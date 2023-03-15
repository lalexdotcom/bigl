import type { Chalk } from "chalk";
import os from "os";
import { WriteStream } from "tty";
import type { inspect, InspectOptions } from "util";

// const inNode = (() => {
//   try {
//     const proc = require("process");
//     return proc?.versions != null && proc?.versions?.node != null;
//   } catch (e) {
//     return false;
//   }
// })();
const inNode =
  typeof process !== "undefined" &&
  process?.versions != null &&
  process?.versions?.node != null;
const inBrowser =
  typeof window !== "undefined" && typeof window.document !== "undefined";

let chalk: Chalk | undefined;
let utilInspect: typeof inspect;
// let OS: typeof os;
if (inNode) {
  try {
    const chalkLib = require(`${"chalk"}`);
    if (chalkLib) chalk = new chalkLib.Instance();
  } catch (e) {}
  try {
    utilInspect = require(`${"util"}`)?.inspect;
  } catch (e) {}
  //   try {
  //     OS = require("os");
  //   } catch (e) {}
}

type LogParameters = Parameters<typeof console.log>;

export enum LogLevel {
  EMERGENCY = 0,
  ALERT = 1,
  CRITICAL = 2,
  ERROR = 3,
  WARNING = 4,
  NOTICE = 5,
  INFO = 6,
  VERBOSE = 7,
  DEBUG = 8,
  WHO_CARES = 9,
}

type LogMethod = {
  (...args: LogParameters): void;
  spin: (
    message: string,
    options?: Omit<SpinnerOptions, "text">
  ) => LoggerSpinner;
};

const LEVEL_METHODS = {
  emerg: LogLevel.EMERGENCY,
  alert: LogLevel.ALERT,
  crit: LogLevel.CRITICAL,
  error: LogLevel.ERROR,
  warn: LogLevel.WARNING,
  notice: LogLevel.NOTICE,
  info: LogLevel.INFO,
  verb: LogLevel.VERBOSE,
  debug: LogLevel.DEBUG,
  wth: LogLevel.WHO_CARES,
};

type GenericLogger = {
  [key in keyof typeof LEVEL_METHODS]: LogMethod;
} & {
  log: (level: LogLevel, ...args: LogParameters) => void;
  getPrefix(level: LogLevel): string;
};

type LoggerOptions = {
  enabled: boolean;
  stack: boolean;
  date: boolean;
  duration: boolean;
  level: LogLevel | undefined;
  pad: boolean;
  color: boolean;

  inspect: InspectOptions;
};

const DEFAULT_INSPECT_OPTIONS: InspectOptions = {
  depth: 5,
  colors: true,
};

export interface Logger extends GenericLogger, LoggerOptions {
  exclusive: boolean;

  once(key?: string): GenericLogger;
  limit(count: number, key?: string): GenericLogger;
  limit(key: string): GenericLogger;
}

export interface RootLogger extends Logger {
  scope(scopeName: string, options?: Partial<LoggerOptions>): ScopeLogger;

  patch(): void;
  unpatch(): void;
}

export interface ScopeLogger extends Logger {
  readonly scope: string;
}

type LoggerRegistry = {
  root: RootLoggerInstance;
  scopes: { [key: string]: ScopeLoggerInstance | undefined };
  exclusive?: Logger;
};

const DEFAULT_LOGGER_OPTIONS: LoggerOptions = {
  enabled: true,
  level: undefined,

  stack: false,
  date: false,
  duration: false,
  pad: inNode && process.stdout.isTTY,
  color: true,

  inspect: DEFAULT_INSPECT_OPTIONS,
};

abstract class LoggerBase implements Logger {
  options: LoggerOptions;
  lastLog?: number;

  private static createLogMethod = (
    logger: LoggerBase,
    level: LogLevel
  ): LogMethod => {
    const logFunction = function (...args: LogParameters) {
      return logger.logAtLevel(level, ...args);
    };
    logFunction.spin = function (
      message: string,
      options?: Omit<SpinnerOptions, "text">
    ) {
      if (inBrowser)
        throw new Error(".spin() cannot be used in browser environment");
      const spinner = new SpinnerImpl(logger, level, {
        ...options,
        text: message,
      });
      spinner.start();
      printBuffer();
      return spinner;
    };
    return logFunction;
  };

  #limits: { [key: string]: GenericLogger } = {};

  #limitedProxy(count: number): GenericLogger {
    let proxyCount = 0;
    return new Proxy(this, {
      get(target, prop) {
        if (prop in LEVEL_METHODS && ++proxyCount > count) return () => {};
        const method = target[prop as keyof typeof target];
        return method;
      },
    });
  }

  readonly emerg!: LogMethod;
  readonly alert!: LogMethod;
  readonly crit!: LogMethod;
  readonly error!: LogMethod;
  readonly warn!: LogMethod;
  readonly notice!: LogMethod;
  readonly info!: LogMethod;
  readonly verb!: LogMethod;
  readonly debug!: LogMethod;
  readonly wth!: LogMethod;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = { ...DEFAULT_LOGGER_OPTIONS, ...options };
    for (const [method, level] of Object.entries(LEVEL_METHODS)) {
      // ! Bad LAlex ! You should never do that
      this[method as "emerg"] = LoggerBase.createLogMethod(this, level);
    }
  }

  once(key?: string): GenericLogger {
    return this.limit(1, key || getCallerLimitKey());
  }

  limit(key: string): GenericLogger;
  limit(count: number, key?: string): GenericLogger;
  limit(countOrKey: number | string, key?: string): GenericLogger {
    if (typeof countOrKey === "string") {
      if (!this.#limits[countOrKey]) {
        throw new Error("Limit ");
      } else {
        return this.#limits[countOrKey];
      }
    }
    key ??= getCallerLimitKey();
    if (key === undefined) {
      throw new Error("Invalid key");
    } else {
      return (this.#limits[key] ??= this.#limitedProxy(countOrKey));
    }
    // throw new Error("Method not implemented.");
  }

  protected logAtLevel(level: LogLevel, ...args: LogParameters) {
    return outputLog(level, args, this);
  }

  getPrefix(level: LogLevel) {
    return getNodePrefix(level, this);
  }

  log(level: LogLevel, ...args: LogParameters): void {
    return this.logAtLevel(level, ...args);
  }

  get exclusive() {
    return registry.exclusive == this;
  }

  set exclusive(b: boolean) {
    registry.exclusive = this.exclusive ? undefined : this;
  }

  protected setOption<K extends keyof LoggerOptions>(
    key: K,
    value: LoggerOptions[K]
  ) {
    this.options[key] = value;
  }

  protected getOption<K extends keyof LoggerOptions>(key: K) {
    return this.options[key];
  }

  get enabled() {
    return this.getOption("enabled");
  }

  set enabled(b: boolean) {
    this.setOption("enabled", b);
  }

  get stack() {
    return this.getOption("stack");
  }

  set stack(b: boolean) {
    this.setOption("stack", b);
  }

  get date() {
    return this.getOption("date");
  }

  set date(b: boolean) {
    this.setOption("date", b);
  }

  get duration() {
    return this.getOption("duration");
  }

  set duration(b: boolean) {
    this.setOption("duration", b);
  }

  get level() {
    return this.getOption("level");
  }

  set level(lvl: LogLevel | undefined) {
    this.setOption("level", lvl);
  }

  get pad() {
    return this.getOption("pad");
  }

  set pad(b: boolean) {
    this.setOption("pad", b);
  }

  set inspect(opts: InspectOptions) {
    this.setOption("inspect", { ...opts });
  }

  get inspect() {
    return { ...this.getOption("inspect") };
  }

  set color(b: boolean) {
    this.setOption("color", b);
  }

  get color() {
    return this.getOption("color");
  }
}

class RootLoggerInstance extends LoggerBase implements RootLogger {
  private static __originalMethods: Partial<Record<keyof typeof console, any>> =
    {
      log: console.log,
      info: console.info,
      debug: console.debug,
      error: console.error,
      warn: console.warn,
    };

  scope(scopeName: string, options: Partial<LoggerOptions> = {}): ScopeLogger {
    let scopeLogger = registry.scopes[scopeName];
    scopeLogger ??= registry.scopes[scopeName] = new ScopeLoggerInstance(
      scopeName,
      this,
      options
    );
    return scopeLogger;
  }

  patch() {
    console.log = console.info = this.info.bind(this);
    console.debug = this.debug.bind(this);
    console.warn = this.warn.bind(this);
    console.error = this.crit.bind(this);
  }

  unpatch() {
    Object.keys(RootLoggerInstance.__originalMethods).forEach((k) => {
      const method = k as keyof typeof console;
      console[method] = RootLoggerInstance.__originalMethods[method];
    });
  }
}

class ScopeLoggerInstance extends LoggerBase implements ScopeLogger {
  readonly scope: string;
  readonly parent: RootLogger;

  constructor(
    scope: string,
    root: RootLoggerInstance,
    options?: Partial<LoggerOptions>
  ) {
    super(options);
    this.scope = scope;
    this.parent = root;
  }

  protected logAtLevel(level: LogLevel, ...args: LogParameters) {
    return outputLog(level, args, this, this.scope);
  }

  getPrefix(level: LogLevel): string {
    return getNodePrefix(level, this, this.scope);
  }
}

type LogLevelStyle = {
  backgroundColor?: string;
  color?: string;
};

const DEFAULT_BROWSER_STYLE = {
  padding: "2px 4px",
  "border-radius": "2px",
};

type LogLevelParam = {
  label: string;
  paddedLabel?: string;
  methods: (typeof console.log)[];
  style?: Partial<LogLevelStyle>;
  css?: string;
};

const DEFAULT_LEVEL_STYLE: LogLevelStyle = {
  backgroundColor: "grey",
  color: "white",
};

const LEVEL_PARAMS: { [key in LogLevel]: LogLevelParam } = {
  [LogLevel.EMERGENCY]: {
    label: "EMERGENCY",
    methods: [console.error, console.trace],
    style: {
      backgroundColor: "red",
    },
  },
  [LogLevel.ALERT]: {
    label: "ALERT",
    methods: [console.error, console.trace],
    style: {
      backgroundColor: "red",
    },
  },
  [LogLevel.CRITICAL]: {
    label: "CRITICAL",
    methods: [console.error, console.trace],
    style: {
      backgroundColor: "red",
    },
  },
  [LogLevel.ERROR]: {
    label: "ERROR",
    methods: [console.error],
    style: {
      backgroundColor: "red",
    },
  },
  [LogLevel.WARNING]: {
    label: "WARNING",
    methods: [console.warn],
    style: {
      color: "white",
      backgroundColor: "orange",
    },
  },
  [LogLevel.NOTICE]: {
    label: "NOTICE",
    methods: [console.info],
    style: {
      backgroundColor: "blue",
    },
  },
  [LogLevel.INFO]: {
    label: "INFO",
    methods: [console.info],
  },
  [LogLevel.VERBOSE]: {
    label: "VERBOSE",
    methods: [console.debug],
    style: {
      // color: 'green',
      backgroundColor: "green",
    },
  },
  [LogLevel.DEBUG]: {
    label: "DEBUG",
    methods: [console.info],
    style: {
      backgroundColor: "yellow",
      color: "black",
    },
  },
  [LogLevel.WHO_CARES]: {
    label: "WHO CARES?",
    methods: [console.debug],
    style: {
      backgroundColor: "lightgray",
      color: "black",
    },
  },
};

if (inNode) {
  const padSize = Math.max(
    ...Object.values(LEVEL_PARAMS).map((info) => info.label.length)
  );
  for (const lvl of Object.values(LEVEL_PARAMS)) {
    lvl.paddedLabel = lvl.label
      .padEnd(lvl.label.length + (padSize - lvl.label.length) / 2, " ")
      .padStart(padSize, " ");
  }
}
for (const lvl of Object.values(LEVEL_PARAMS)) {
  lvl.style = { ...DEFAULT_LEVEL_STYLE, ...lvl.style };
  if (inBrowser) {
    lvl.css = css(lvl.style);
  }
}

function css(style: Partial<LogLevelStyle>) {
  const STYLE_MAP: { [key in keyof Partial<LogLevelStyle>]: string } = {
    backgroundColor: "background-color",
  };

  const cssObject: Record<string, unknown> = { ...DEFAULT_BROWSER_STYLE };
  for (const [styleKey, styleValue] of Object.entries(style)) {
    const cssKey = STYLE_MAP[<keyof LogLevelStyle>styleKey] || styleKey;
    cssObject[cssKey] = styleValue;
  }

  return Object.entries(cssObject)
    .map(([key, value]) => `${key}: ${value}`)
    .join(";");
}

const computeOptions = (logger: LoggerBase) => {
  const computed = { ...logger.options },
    root = registry.root;
  for (const [key, value] of Object.entries(computed)) {
    switch (key) {
      case "level":
        computed[key] =
          root.level === undefined
            ? computed.level
            : computed.level === undefined
            ? root.level
            : Math.min(root.level, computed.level);
        break;
      case "date":
      case "duration":
      case "pad":
      case "stack":
        computed[key] ||= root[key];
        break;
      case "color":
        computed[key] &&= root[key];
        break;
      case "inspect":
        computed[key] = { ...root.options[key], ...computed[key] };
        break;
    }
  }
  return computed;
};

const getNodePrefix = (
  logLevel: LogLevel,
  logger: LoggerBase,
  scope?: string
) => {
  const { pad, color } = computeOptions(logger);
  const levelParams = LEVEL_PARAMS[logLevel];
  let levelPrefix = (pad && levelParams.paddedLabel) || levelParams.label;
  if (scope) levelPrefix += ` <${scope}>`;
  if (inNode) {
    if (color && chalk) {
      let colorize = chalk;
      if (levelParams.style?.color) {
        colorize = colorize.keyword(levelParams.style.color);
      }
      if (levelParams.style?.backgroundColor)
        colorize = colorize.bgKeyword(levelParams.style.backgroundColor);
      return colorize(` ${levelPrefix} `);
    } else {
      return `[${levelPrefix}]`;
    }
  } else {
    return "";
  }
};

const getBrowserPrefix = (
  logLevel: LogLevel,
  logger: LoggerBase,
  scope?: string
) => {
  const { color, pad } = computeOptions(logger);
  const levelParams = LEVEL_PARAMS[logLevel];
  let levelPrefix = (pad && levelParams.paddedLabel) || levelParams.label;
  if (scope) levelPrefix += ` <${scope}>`;
  return color ? [`%c${levelPrefix}`, levelParams.css!] : [`[${levelPrefix}]`];
};

const outputLog = (
  logLevel: LogLevel,
  args: LogParameters,
  logger: LoggerBase,
  scope?: string
) => {
  try {
    if (!logger.enabled || !root.enabled) return;
    if (registry.exclusive && registry.exclusive !== logger) return;

    const {
      date,
      duration: time,
      level,
      stack,
      inspect,
    } = computeOptions(logger);

    if (!LEVEL_PARAMS[logLevel]) return;
    if (level && level < logLevel) return;
    const levelParams = LEVEL_PARAMS[logLevel];

    let logPrefix: string[] = inNode
      ? [getNodePrefix(logLevel, logger, scope)]
      : getBrowserPrefix(logLevel, logger, scope);

    if (time || date) {
      if (time) logger.lastLog ??= new Date().valueOf();
      let now: Date = new Date();
      if (date) {
        const datePrefix = getDatePrefix(now);
        logPrefix.push(datePrefix);
      }
      if (time) {
        const timePrefix = getDurationPrefix(now.valueOf() - logger.lastLog!);
        logger.lastLog = new Date().valueOf();
        logPrefix.push(timePrefix);
      }
    }
    if (stack) {
      const caller = getLogCallerInfo();
      let stackDisplay =
        caller?.functionName ||
        caller?.fileName?.split("/").slice(-1).join("/") +
          ":" +
          caller?.lineNumber +
          ":" +
          caller?.columnNumber;
      if (caller?.functionName && caller?.fileName)
        stackDisplay +=
          " @ " +
          caller?.fileName +
          ":" +
          caller?.lineNumber +
          ":" +
          caller?.columnNumber;
      if (stackDisplay) logPrefix.push(`(${stackDisplay})`);
    }

    if (inNode && utilInspect) {
      try {
        args = args.map((a) =>
          typeof a === "string"
            ? a
            : utilInspect(a, inspect ?? DEFAULT_INSPECT_OPTIONS)
        );
      } catch (e) {}
    }
    if (isBuffered()) {
      const outputString = [...logPrefix, ...args]
        .map((a) => a.toString())
        .join(" ");
      bufferedContent.push({
        content: outputString,
        lines: getContentLines(outputString),
      });
      printBuffer();
    } else {
      levelParams.methods.map((method) =>
        method.apply(globalThis, [...logPrefix, ...args])
      );
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : JSON.stringify(e));
  }
};

function getDatePrefix(date: Date) {
  return (
    "[" +
    date.getFullYear() +
    "-" +
    `${date.getMonth() + 1}`.padStart(2, "0") +
    "-" +
    `${date.getDate()}`.padStart(2, "0") +
    " " +
    `${date.getHours()}`.padStart(2, "0") +
    ":" +
    `${date.getMinutes()}`.padStart(2, "0") +
    ":" +
    `${date.getSeconds()}`.padStart(2, "0") +
    "." +
    `${(date.getMilliseconds() / 1000).toFixed(3).slice(2, 5)}`.padStart(
      2,
      "0"
    ) +
    "]"
  );
}

function getDurationPrefix(durationMs: number): string;
function getDurationPrefix(since: Date, to?: Date): string;
function getDurationPrefix(sinceOrDurationMs: Date | number, to?: Date) {
  const duration =
    typeof sinceOrDurationMs === "number"
      ? sinceOrDurationMs
      : (to ?? new Date()).valueOf() - sinceOrDurationMs.valueOf();
  return `[+${(duration / 1000).toFixed(3)}s]`;
}

const getCallerLimitKey = () => getCallerStack(4);
const getLogCallerInfo = ():
  | {
      functionName?: string;
      fileName?: string;
      columnNumber?: string;
      lineNumber?: string;
    }
  | undefined => {
  const stack = getCallerStack(6);
  if (stack) {
    return inNode
      ? stack.match(
          /at (?<fileName>.*):(?<lineNumber>[0-9]*):(?<columnNumber>[0-9]*)/
        )?.groups
      : stack.match(
          /at (?<functionName>.*) \(?(?<fileName>.*):(?<lineNumber>[0-9]*):(?<columnNumber>[0-9]*)\)/
        )?.groups;
  }
};

const getCallerStack = (level: number): string | undefined => {
  let err: Error;
  try {
    throw new Error();
  } catch (e) {
    err = e as Error;
  }
  const stack = err.stack?.split("\n") || [];
  return stack.slice(level)[0];
};

const registry = (() => {
  if (typeof globalThis === "undefined") throw new Error("No globalThis found");
  const anyGlobal = globalThis as any,
    registryName = "$logger-registry";
  if (!anyGlobal[registryName]) {
    const emptyRegistry: LoggerRegistry = {
      root: new RootLoggerInstance(),
      scopes: {},
    };
    anyGlobal[registryName] = emptyRegistry;
  }
  return anyGlobal[registryName] as LoggerRegistry;
})();

const root = registry.root;

export const LG: RootLogger = root as RootLogger;
export const Logger: RootLogger = root;

// Spinner

type SpinnerOptions = {
  text: string;
  prefix?: string;
  spinner?: string[];
  successIcon?: string;
  failIcon?: string;
  date?: boolean;
  duration?: boolean;
};

export interface LoggerSpinner {
  update(text: string): void;
  success(text?: string): void;
  fail(text?: string): void;
  stop(): void;
  toString(): string;
}

const DEFAULT_SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split("").map((s) => chalk?.cyan(s) ?? s);
const DEFAULT_SUCCESS_ICON = chalk?.green("✔") ?? "✔";
const DEFAULT_FAIL_ICON = chalk?.red("✖") ?? "✖";

class SpinnerImpl implements LoggerSpinner {
  private _prefix?: string | false;
  private _text: string = "";

  private _iconIndex!: number;
  private _icon!: string | string[] | null;

  private _logger: LoggerBase;
  private _level: LogLevel;

  // private _loggerOptions: LoggerOptions;

  $started?: Date;
  $stopped?: Date;

  private options: SpinnerOptions;

  constructor(logger: LoggerBase, level: LogLevel, options: SpinnerOptions) {
    this._logger = logger;
    this._level = level;
    // this._loggerOptions = { ...computeOptions(logger) };
    this.options = {
      spinner: DEFAULT_SPINNER,
      successIcon: DEFAULT_SUCCESS_ICON,
      failIcon: DEFAULT_FAIL_ICON,
      ...options,
    };
    this.init();
  }

  init() {
    this._prefix = this.options.prefix;
    this.setText(this.options.text);
    this.icon = (this.options.spinner ?? null) || DEFAULT_SPINNER;
  }

  setText(text: string) {
    this._text = text;
  }

  set icon(icon: string | string[] | null) {
    this._icon = icon;
    this._iconIndex = 0;
  }

  get icon(): string | string[] | null {
    return this._icon;
  }

  start() {
    if (!root.enabled || !this._logger.enabled) return;
    if (!this.$started) {
      this.$started = new Date();
      runningSpinners.add(this);
      bufferedContent.push({ content: this });
      if (!isBuffered()) {
        startBuffering();
      }
      if (!isBuffered()) {
        this._logger.log(this._level, this.toString(false));
      }
    }
  }

  update(text: string) {
    this.setText(text);
  }

  success(text?: string) {
    if (text !== undefined) this.setText(text);
    this.icon = this.options.successIcon ?? null;
    this.stop();
  }

  fail(text?: string) {
    if (text !== undefined) this.setText(text);
    this.icon = this.options.failIcon ?? null;
    this.stop();
  }

  stop() {
    if (!this.$stopped && !!this.$started) {
      this.$stopped = new Date();
      runningSpinners.delete(this);
      if (!isBuffered()) {
        this._logger.log(this._level, this.toString(false));
      } else if (!isSpinning()) {
        stopBuffering();
      }
    }
  }

  spin() {
    if (
      this.$started &&
      !this.$stopped &&
      this._icon &&
      this._icon.length > 1
    ) {
      this._iconIndex++;
      if (this._iconIndex >= this._icon.length) this._iconIndex = 0;
    }
  }

  toString(withLevelPrefix?: boolean): string {
    let textString = "";
    if (this._prefix !== false) {
      if (withLevelPrefix ?? true)
        textString += this._logger.getPrefix(this._level) + " ";
      if (this._prefix) textString += this._prefix + " ";
    }
    if (this.options.date && this.$started) {
      textString += getDatePrefix(this.$started) + " ";
    }
    if (this.options.duration && this.$started) {
      textString += getDurationPrefix(this.$started, this.$stopped) + " ";
    }
    if (Array.isArray(this._icon)) {
      if (this._icon?.[this._iconIndex]) {
        textString += this._icon?.[this._iconIndex] + " ";
      }
    } else if (this._icon !== null) {
      textString += this._icon + " ";
    }
    textString += this._text;
    return textString;
  }
}

const runningSpinners: Set<SpinnerImpl> = new Set();
let spinnersRefreshInterval: ReturnType<typeof setInterval> | undefined =
  undefined;

const bufferStream: WriteStream = process?.stdout;
let bufferedContent: { content: string | SpinnerImpl; lines?: number }[] = [];
let bufferedDisplayLineCount = 0;

function getContentLines(str: string, columns?: number) {
  columns ??= bufferStream.columns || 80;
  let lines = 0;
  str
    .replace(
      new RegExp(
        [
          "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
          "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
        ].join("|"),
        "g"
      ),
      ""
    )
    .split(os?.EOL)
    .forEach((ln) => {
      lines += Math.max(1, Math.ceil(ln.length) / columns!);
    });
  return lines;
}

function isSpinning() {
  return runningSpinners.size;
}

function isBuffered() {
  return spinnersRefreshInterval !== undefined;
}

function startBuffering() {
  if (bufferStream.isTTY && !isBuffered()) {
    bufferStream.write("\u001B[?25l");
    spinnersRefreshInterval = setInterval(() => {
      runningSpinners.forEach((s) => s.spin());
      printBuffer();
    }, 80);
    printBuffer();
  }
}

function stopBuffering() {
  if (isBuffered()) {
    printBuffer();
    bufferStream.write(os?.EOL);
    clearInterval(spinnersRefreshInterval);
    bufferedContent = [];
    bufferedDisplayLineCount = 0;
    spinnersRefreshInterval = undefined;
  }
}

function printBuffer() {
  if (!isBuffered()) return;
  bufferStream.cursorTo(0);
  for (
    let clearLineIndex = 0;
    clearLineIndex < bufferedDisplayLineCount;
    clearLineIndex++
  ) {
    if (clearLineIndex) bufferStream.moveCursor(0, -1);
    bufferStream.clearLine(1);
  }

  bufferedDisplayLineCount = 0;

  bufferStream.write(
    bufferedContent
      .map((buff) => {
        const content = buff.content.toString();
        bufferedDisplayLineCount += buff.lines ?? getContentLines(content);
        return content;
      })
      .join(os?.EOL)
  );
}
