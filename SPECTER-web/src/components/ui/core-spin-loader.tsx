import React, { useState, useEffect } from 'react'

export function CoreSpinLoader() {
    const [loadingText, setLoadingText] = useState('Initializing')

    useEffect(() => {
        const states = ['Quantum Syncing...', 'Entangling Keys..', 'Spectral Routing...', 'Lattice Probing..', 'Stealth Resolving...']
        let i = 0
        const interval = setInterval(() => {
            i = (i + 1) % states.length
            setLoadingText(states[i])
        }, 1000)

        return () => clearInterval(interval)
    }, [])

    return (
        <div className="flex flex-col items-center justify-center min-h-[200px] gap-8">
            <div className="relative w-20 h-20 flex items-center justify-center">

                {/* Base Glow */}
                <div className="
          absolute inset-0 rounded-full blur-xl animate-pulse
          bg-emerald-400/15
          dark:bg-cyan-500/10
        " />

                {/* Outer Dashed Ring */}
                <div className="
          absolute inset-0 rounded-full border border-dashed
          border-emerald-500/40
          dark:border-cyan-500/20
          animate-[spin_10s_linear_infinite]
        " />

                {/* Main Arc */}
                <div className="
          absolute inset-1 rounded-full border-2 border-transparent
          border-t-emerald-500
          dark:border-t-cyan-400
          shadow-[0_0_6px_rgba(16,185,129,0.5)]
          dark:shadow-[0_0_10px_rgba(34,211,238,0.4)]
          animate-[spin_2s_linear_infinite]
        " />

                {/* Reverse Arc */}
                <div className="
          absolute inset-3 rounded-full border-2 border-transparent
          border-b-green-600
          dark:border-b-purple-500
          shadow-[0_0_6px_rgba(22,163,74,0.4)]
          dark:shadow-[0_0_10px_rgba(168,85,247,0.4)]
          animate-[spin_3s_linear_infinite_reverse]
        " />

                {/* Inner Fast Ring */}
                <div className="
          absolute inset-5 rounded-full border border-transparent
          border-l-green-700/60
          dark:border-l-white/50
          animate-[spin_1s_ease-in-out_infinite]
        " />

                {/* Orbital Dot */}
                <div className="absolute inset-0 animate-[spin_4s_linear_infinite]">
                    <div className="
            absolute top-0 left-1/2 -translate-x-1/2
            w-1 h-1 rounded-full
            bg-emerald-600
            dark:bg-cyan-400
            shadow-[0_0_4px_rgba(16,185,129,0.9)]
            dark:shadow-[0_0_6px_rgba(34,211,238,0.8)]
          " />
                </div>

                {/* Center Core */}
                <div className="
          absolute w-2 h-2 rounded-full animate-pulse
          bg-emerald-700
          dark:bg-white
          shadow-[0_0_6px_rgba(16,185,129,0.6)]
          dark:shadow-[0_0_10px_rgba(255,255,255,0.8)]
        " />
            </div>

            {/* Text */}
            <div className="flex flex-col items-center gap-1 h-8 justify-center">
                <span
                    key={loadingText}
                    className="
            text-[10px] font-medium tracking-[0.3em] uppercase
            text-emerald-700
            dark:text-cyan-200/70
            animate-in fade-in slide-in-from-bottom-2 duration-500
          "
                >
                    {loadingText}
                </span>
            </div>
        </div>
    )
}
