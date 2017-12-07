
/**
 * Global Settings
 * @author S. Hermans <s.hermans@maxxton.com>
 */
export class Settings {

  public static get<T>(key: string, defaultValue?: T): T {
    return (process.env[key.replace(/\./g, "_").toUpperCase()] || defaultValue || null) as T;
  }

  public static getString(key: string, defaultValue?: string): string {
    return Settings.get<string>(key, defaultValue);
  }

}
