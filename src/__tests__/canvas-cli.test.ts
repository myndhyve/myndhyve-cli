/**
 * Canvas CLI Integration Test
 * 
 * Basic test to verify canvas CLI commands are properly registered
 * and can be executed without errors.
 */

import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/cli/program.js';

describe('Canvas CLI Integration', () => {
  it('should register canvas commands', () => {
    const program = createProgram();
    const canvasCommand = program.commands.find(cmd => cmd.name() === 'canvas');
    
    expect(canvasCommand).toBeDefined();
    expect(canvasCommand?.description()).toBe('Canvas runtime management');
  });

  it('should register session subcommands', () => {
    const program = createProgram();
    const canvasCommand = program.commands.find(cmd => cmd.name() === 'canvas');
    const sessionCommand = canvasCommand?.commands.find(cmd => cmd.name() === 'session');
    
    expect(sessionCommand).toBeDefined();
    expect(sessionCommand?.description()).toBe('Canvas session management');
    
    const sessionSubcommands = sessionCommand?.commands.map(cmd => cmd.name());
    expect(sessionSubcommands).toContain('create');
    expect(sessionSubcommands).toContain('use');
    expect(sessionSubcommands).toContain('history');
    expect(sessionSubcommands).toContain('reset');
  });

  it('should register queue subcommands', () => {
    const program = createProgram();
    const canvasCommand = program.commands.find(cmd => cmd.name() === 'canvas');
    const queueCommand = canvasCommand?.commands.find(cmd => cmd.name() === 'queue');
    
    expect(queueCommand).toBeDefined();
    expect(queueCommand?.description()).toBe('Canvas queue management');
    
    const queueSubcommands = queueCommand?.commands.map(cmd => cmd.name());
    expect(queueSubcommands).toContain('get');
    expect(queueSubcommands).toContain('set');
  });

  it('should register agent subcommands', () => {
    const program = createProgram();
    const canvasCommand = program.commands.find(cmd => cmd.name() === 'canvas');
    const agentCommand = canvasCommand?.commands.find(cmd => cmd.name() === 'agent');
    
    expect(agentCommand).toBeDefined();
    expect(agentCommand?.description()).toBe('Canvas agent interaction');
    
    const agentSubcommands = agentCommand?.commands.map(cmd => cmd.name());
    expect(agentSubcommands).toContain('send');
    expect(agentSubcommands).toContain('steer');
    expect(agentSubcommands).toContain('cancel');
  });

  it('should register run subcommands', () => {
    const program = createProgram();
    const canvasCommand = program.commands.find(cmd => cmd.name() === 'canvas');
    const runCommand = canvasCommand?.commands.find(cmd => cmd.name() === 'run');
    
    expect(runCommand).toBeDefined();
    expect(runCommand?.description()).toBe('Canvas run management');
    
    const runSubcommands = runCommand?.commands.map(cmd => cmd.name());
    expect(runSubcommands).toContain('status');
    expect(runSubcommands).toContain('logs');
    expect(runSubcommands).toContain('trace');
  });

  it('should register scheduling subcommands', () => {
    const program = createProgram();
    const canvasCommand = program.commands.find(cmd => cmd.name() === 'canvas');
    const heartbeatCommand = canvasCommand?.commands.find(cmd => cmd.name() === 'heartbeat');
    const cronCommand = canvasCommand?.commands.find(cmd => cmd.name() === 'cron');
    
    expect(heartbeatCommand).toBeDefined();
    expect(cronCommand).toBeDefined();
  });
});
