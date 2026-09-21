declare module 'node-cron' {
  export interface ScheduledTask {
    start: () => void;
    stop: () => void;
  }

  export interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
  }

  export function schedule(
    expression: string,
    func: () => void | Promise<void>,
    options?: ScheduleOptions
  ): ScheduledTask;

  export function validate(expression: string): boolean;

  const cron: {
    schedule: typeof schedule;
    validate: typeof validate;
  };

  export default cron;
}
