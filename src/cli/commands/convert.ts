import { Command } from 'commander';
import { readInput, writeOutput, parseJSON, formatJSON } from '../utils/file-io.js';
import { success, error as displayError, info } from '../utils/output.js';
import { ambToNostr, nostrToAmb } from '../../converters/index.js';
import { ConversionOptions } from '../../types/index.js';
import { parsePrivateKey, derivePublicKey, signNostrEvent } from '../../utils/signing.js';

/**
 * Conversion direction
 */
type ConversionDirection = 'amb:nostr' | 'nostr:amb';

/**
 * Parse conversion direction from string
 */
function parseDirection(direction: string): ConversionDirection {
  const normalized = direction.toLowerCase().trim();
  
  if (normalized === 'amb:nostr' || normalized === 'amb-nostr') {
    return 'amb:nostr';
  }
  
  if (normalized === 'nostr:amb' || normalized === 'nostr-amb') {
    return 'nostr:amb';
  }
  
  throw new Error(
    `Invalid conversion direction: "${direction}". Must be "amb:nostr" or "nostr:amb"`
  );
}

interface ConvertCommandOptions {
  output?: string;
  pretty?: boolean;
  tags?: boolean;
  nsec?: string;
  privateKey?: string;
}

/**
 * Execute conversion
 */
async function executeConvert(
  direction: ConversionDirection,
  inputFilePath: string | undefined,
  options: ConvertCommandOptions
): Promise<void> {
  try {
    // Validate mutually exclusive options
    if (options.nsec && options.privateKey) {
      throw new Error('Cannot specify both --nsec and --private-key options');
    }
    
    // Read input data
    const inputData = await readInput(inputFilePath);
    
    if (!inputData.trim()) {
      throw new Error('Input is empty');
    }
    
    const inputJson = parseJSON(inputData);

    // Handle private key if provided (only for amb:nostr direction)
    let privateKeyHex: string | undefined;
    let derivedPubkey: string | undefined;
    
    if (direction === 'amb:nostr' && (options.nsec || options.privateKey)) {
      const keyInput = options.nsec || options.privateKey!;
      privateKeyHex = parsePrivateKey(keyInput);
      derivedPubkey = derivePublicKey(privateKeyHex);
      info(`Derived pubkey: ${derivedPubkey}`);
    }

    // Prepare conversion options
    const conversionOptions: ConversionOptions = {};
    
    // Use derived pubkey if signing
    if (derivedPubkey) {
      conversionOptions.pubkey = derivedPubkey;
    }

    let result: any;
    let outputData: string;

    // Perform conversion based on direction
    if (direction === 'amb:nostr') {
      info('Converting AMB to Nostr...');
      const conversionResult = ambToNostr(inputJson, conversionOptions);
      
      if (!conversionResult.success) {
        throw new Error(conversionResult.error?.message || 'Conversion failed');
      }
      
      // Display warnings if any
      if (conversionResult.warnings && conversionResult.warnings.length > 0) {
        conversionResult.warnings.forEach(warning => {
          console.error(`⚠ Warning: ${warning}`);
        });
      }
      
      if (!conversionResult.data) {
        throw new Error('Conversion succeeded but no data was returned');
      }
      
      let event = conversionResult.data;
      
      // Sign the event if private key was provided
      if (privateKeyHex) {
        info('Signing event...');
        event = signNostrEvent(event, privateKeyHex);
        info(`Event ID: ${event.id}`);
      }
      
      // Output based on --tags flag
      if (options.tags) {
        // Output only tags array
        result = event.tags;
      } else {
        // Output full event
        result = event;
      }
      
      outputData = formatJSON(result, options.pretty);
      
    } else {
      // nostr:amb direction
      info('Converting Nostr to AMB...');
      
      // Signing options don't apply to nostr→amb conversion
      if (options.nsec || options.privateKey) {
        console.error('⚠ Warning: --nsec and --private-key options are ignored for nostr:amb conversion');
      }
      
      // --tags option doesn't apply to nostr→amb
      if (options.tags) {
        console.error('⚠ Warning: --tags option is ignored for nostr:amb conversion');
      }
      
      const conversionResult = nostrToAmb(inputJson);
      
      if (!conversionResult.success) {
        throw new Error(conversionResult.error?.message || 'Conversion failed');
      }
      
      if (!conversionResult.data) {
        throw new Error('Conversion succeeded but no data was returned');
      }
      
      result = conversionResult.data;
      outputData = formatJSON(result, options.pretty);
    }

    // Write output
    await writeOutput(outputData, options.output);
    
    if (options.output) {
      success(`Conversion complete! Output written to: ${options.output}`);
    } else {
      // Data already written to stdout, just show success to stderr
      success('Conversion complete!');
    }
    
  } catch (err) {
    displayError(
      err instanceof Error ? err.message : 'Unknown error occurred'
    );
    process.exit(1);
  }
}

/**
 * Create convert command
 */
export function createConvertCommand(): Command {
  const command = new Command();
  
  command
    .description('Convert between AMB and Nostr educational event formats')
    .argument('<direction>', 'Conversion direction: "amb:nostr" or "nostr:amb"')
    .argument('[input]', 'Input file path (omit to read from stdin)')
    .option('-o, --output <file>', 'Output file path (omit to write to stdout)')
    .option('-p, --pretty', 'Pretty-print JSON output', false)
    .option('--tags', 'Output only the tags array', false)
    .option('--nsec <key>', 'Sign event with nsec (bech32 format private key)')
    .option('--private-key <key>', 'Sign event with hex private key')
    .action(async (directionStr: string, inputFile: string | undefined, options: ConvertCommandOptions) => {
      try {
        const direction = parseDirection(directionStr);
        await executeConvert(direction, inputFile, options);
      } catch (err) {
        displayError(
          err instanceof Error ? err.message : 'Unknown error occurred'
        );
        process.exit(1);
      }
    });

  return command;
}
