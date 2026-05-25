import React from 'react';
import { cn } from '@/lib/utils';

interface TerminalLoaderProps {
  text?: string;
  className?: string;
}

export function SendingLoader({ text = 'Sending...', className = '' }: TerminalLoaderProps) {
  return (
    <div
      className={cn(
        'terminal-loader relative bg-gray-900 border border-gray-600 font-mono text-base p-6 pt-4 w-full shadow-lg rounded border-opacity-80 overflow-hidden',
        className,
      )}
    >
      <div className="terminal-header absolute top-0 left-0 right-0 h-6 bg-gray-700 rounded-t px-2 flex items-center justify-between">
        <div className="terminal-title text-gray-200 text-sm leading-6">Status</div>
        <div className="terminal-controls flex gap-2">
          <div className="control close w-2.5 h-2.5 rounded-full bg-red-500" />
          <div className="control minimize w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="control maximize w-2.5 h-2.5 rounded-full bg-green-500" />
        </div>
      </div>
      <div className="terminal-loader-text text-green-400 inline-block whitespace-nowrap overflow-hidden mt-6 border-r-2 border-green-400 pr-1">
        {text}
      </div>
    </div>
  );
}
