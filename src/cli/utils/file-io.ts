import { readFile, writeFile } from 'fs/promises';
import { stdin, stdout } from 'process';

/**
 * Read JSON data from a file or stdin
 */
export async function readInput(filePath?: string): Promise<string> {
  if (filePath) {
    return await readFile(filePath, 'utf-8');
  }

  // Read from stdin
  return new Promise((resolve, reject) => {
    let data = '';
    
    stdin.setEncoding('utf-8');
    
    stdin.on('data', (chunk) => {
      data += chunk;
    });
    
    stdin.on('end', () => {
      resolve(data);
    });
    
    stdin.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Write data to a file or stdout
 */
export async function writeOutput(
  data: string,
  filePath?: string
): Promise<void> {
  if (filePath) {
    await writeFile(filePath, data, 'utf-8');
  } else {
    stdout.write(data + '\n');
  }
}

/**
 * Parse JSON data with error handling
 */
export function parseJSON(data: string): any {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Format JSON data for output
 */
export function formatJSON(data: any, pretty: boolean = false): string {
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}
