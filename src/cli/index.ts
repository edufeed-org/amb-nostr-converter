#!/usr/bin/env node

import { Command } from 'commander';
import { createConvertCommand } from './commands/convert.js';
import packageJson from '../../package.json' with { type: 'json' };

const VERSION = packageJson.version;

/**
 * Main CLI entry point
 */
async function main() {
  // Create program that directly uses convert command functionality
  const convertCmd = createConvertCommand();
  
  // Configure the command as the main program
  convertCmd
    .name('amb-convert')
    .version(VERSION);

  await convertCmd.parseAsync(process.argv);
}

// Run CLI
main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
