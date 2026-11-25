#!/usr/bin/env node
// Starts Aurora on all network interfaces and prints the address to open on your phone.
import { spawn } from 'node:child_process';
import os from 'node:os';

const port = process.env.PORT || '3000';
const urls = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${port}`);
console.log('\n  Aurora is starting…');
console.log(`  On this computer:  http://localhost:${port}`);
for (const u of urls) console.log(`  On your phone:     ${u}   (same Wi-Fi)`);
console.log('');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', port], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
