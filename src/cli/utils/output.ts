import chalk from 'chalk';

/**
 * Display success message
 */
export function success(message: string): void {
  console.error(chalk.green('✓'), message);
}

/**
 * Display error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

/**
 * Display info message
 */
export function info(message: string): void {
  console.error(chalk.blue('ℹ'), message);
}

/**
 * Display warning message
 */
export function warning(message: string): void {
  console.error(chalk.yellow('⚠'), message);
}
