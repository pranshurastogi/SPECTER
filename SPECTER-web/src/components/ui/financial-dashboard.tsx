import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronRight,
    ChevronDown,
    History,
    Library,
    Search,
} from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- UTILS ---
function cn(...inputs: any[]) {
    return twMerge(clsx(inputs));
}

// --- TYPE DEFINITIONS ---
type QuickAction = {
    icon: React.ElementType;
    title: string;
    description: string;
    onClick?: () => void;
    /** Inline form that appears when the action is expanded */
    renderForm?: () => React.ReactNode;
};

type Activity = {
    icon: React.ReactNode;
    title: string;
    time: string;
    amount: number;
};

type Service = {
    icon: React.ElementType;
    title: string;
    description: string;
    isPremium?: boolean;
    hasAction?: boolean;
    onClick?: () => void;
    /** Inline form/dropdown that appears when expanded */
    renderForm?: () => React.ReactNode;
};

interface FinancialDashboardProps {
    quickActions: QuickAction[];
    recentActivity: Activity[];
    financialServices: Service[];
    searchPlaceholder?: string;
    expandedQuickAction?: number | null;
    onExpandedQuickActionChange?: (index: number | null) => void;
}

// --- HELPER COMPONENTS ---
const IconWrapper = ({
    icon: Icon,
    className,
}: {
    icon: React.ElementType;
    className?: string;
}) => (
    <div
        className={cn(
            'p-2 rounded-full flex items-center justify-center',
            className
        )}
    >
        <Icon className="w-5 h-5" />
    </div>
);

// --- MAIN COMPONENT ---
export const FinancialDashboard: React.FC<FinancialDashboardProps> = ({
    quickActions,
    recentActivity,
    financialServices,
    searchPlaceholder = 'Search operations, channels, or type a command...',
    expandedQuickAction,
    onExpandedQuickActionChange,
}) => {
    const [expandedAction, setExpandedAction] = React.useState<number | null>(null);
    const [expandedService, setExpandedService] = React.useState<number | null>(null);
    const actionAccents = [
        {
            border: "border-emerald-400/40",
            bg: "bg-emerald-500/8",
            icon: "bg-emerald-500/15 text-emerald-300",
        },
        {
            border: "border-amber-400/40",
            bg: "bg-amber-500/8",
            icon: "bg-amber-500/15 text-amber-300",
        },
        {
            border: "border-sky-400/40",
            bg: "bg-sky-500/8",
            icon: "bg-sky-500/15 text-sky-300",
        },
        {
            border: "border-violet-400/40",
            bg: "bg-violet-500/8",
            icon: "bg-violet-500/15 text-violet-300",
        },
    ] as const;

    const containerVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: { staggerChildren: 0.1 },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 15 },
        visible: { opacity: 1, y: 0 },
    };

    React.useEffect(() => {
        if (expandedQuickAction === undefined) return;
        setExpandedAction(expandedQuickAction);
    }, [expandedQuickAction]);

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="w-full bg-gradient-to-b from-zinc-900/90 via-zinc-900/70 to-zinc-950/70 text-zinc-100 rounded-2xl border border-zinc-700/50 shadow-[0_20px_60px_rgba(0,0,0,0.45)] font-sans backdrop-blur-sm"
        >
            <div className="p-4 md:p-6">
                {/* Search Bar */}
                <motion.div variants={itemVariants} className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                        type="text"
                        placeholder={searchPlaceholder}
                        className="bg-zinc-950/70 w-full border border-zinc-800/80 rounded-lg pl-10 pr-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none transition-all duration-200 focus-visible:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-500/25"
                    />
                    <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center justify-center text-xs font-mono text-zinc-500 bg-zinc-800 p-1 rounded-md border border-zinc-700">
                        ⌘K
                    </kbd>
                </motion.div>

                {/* Quick Actions Grid */}
                <motion.div
                    variants={containerVariants}
                    className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"
                >
                    {quickActions.map((action, index) => {
                        const isExpanded = expandedAction === index;
                        const hasForm = !!action.renderForm;
                        const accent = actionAccents[index % actionAccents.length];

                        return (
                            <motion.div
                                key={index}
                                variants={itemVariants}
                                layout
                                className={cn(
                                    "rounded-xl border border-zinc-800/80 bg-zinc-950/35 transition-all duration-200",
                                    isExpanded
                                        ? `col-span-2 sm:col-span-4 ${accent.bg} ${accent.border} shadow-[0_10px_30px_rgba(0,0,0,0.35)]`
                                        : ""
                                )}
                            >
                                <motion.div
                                    whileHover={{
                                        scale: hasForm && !isExpanded ? 1.02 : 1,
                                        backgroundColor: "rgba(255,255,255,0.03)",
                                    }}
                                    whileTap={{ scale: 0.995 }}
                                    onClick={() => {
                                        if (hasForm) {
                                            const next = isExpanded ? null : index;
                                            setExpandedAction(next);
                                            onExpandedQuickActionChange?.(next);
                                            if (!isExpanded) setExpandedService(null);
                                        } else {
                                            action.onClick?.();
                                        }
                                    }}
                                    className={cn(
                                        "group text-center p-3 rounded-xl cursor-pointer transition-colors duration-200",
                                        isExpanded && "text-left flex items-center gap-3 border-b border-zinc-800/70"
                                    )}
                                >
                                    <IconWrapper
                                        icon={action.icon}
                                        className={cn(
                                            accent.icon,
                                            "group-hover:brightness-110",
                                            isExpanded ? "" : "mx-auto mb-2"
                                        )}
                                    />
                                    <div>
                                        <p className="text-sm font-medium text-zinc-200">{action.title}</p>
                                        <p className="text-xs text-zinc-500">{action.description}</p>
                                    </div>
                                    {isExpanded && (
                                        <ChevronDown className="w-4 h-4 text-amber-400/50 ml-auto" />
                                    )}
                                </motion.div>

                                {/* Inline Form */}
                                <AnimatePresence>
                                    {isExpanded && action.renderForm && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0, y: -4, scale: 0.99 }}
                                            animate={{ height: 'auto', opacity: 1, y: 0, scale: 1 }}
                                            exit={{ height: 0, opacity: 0, y: -4, scale: 0.99 }}
                                            transition={{ duration: 0.24, ease: "easeOut" }}
                                            className="overflow-hidden"
                                        >
                                            <div className="p-4 space-y-3 bg-zinc-950/30">
                                                {action.renderForm()}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    })}
                </motion.div>

                {/* Recent Activity */}
                <motion.div variants={itemVariants} className="mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <History className="w-5 h-5 text-amber-400/70" />
                        <h2 className="text-sm font-semibold text-zinc-300">Recent activity</h2>
                    </div>
                    <motion.ul
                        variants={containerVariants}
                        className="space-y-4"
                    >
                        {recentActivity.length === 0 ? (
                            <li className="text-center py-6">
                                <p className="text-xs text-zinc-600">No recent activity yet. Run an operation to get started.</p>
                            </li>
                        ) : (
                            recentActivity.map((activity, index) => (
                                <motion.li
                                    key={index}
                                    variants={itemVariants}
                                    className="flex items-center justify-between"
                                >
                                    <div className="flex items-center gap-3">
                                        {React.isValidElement(activity.icon) ? (
                                            activity.icon
                                        ) : (
                                            <IconWrapper
                                                icon={activity.icon as React.ElementType}
                                                className="bg-zinc-800 text-zinc-400"
                                            />
                                        )}
                                        <div>
                                            <p className="font-medium text-sm text-zinc-200">{activity.title}</p>
                                            <p className="text-xs text-zinc-500">
                                                {activity.time}
                                            </p>
                                        </div>
                                    </div>
                                    <div
                                        className={cn(
                                            'text-sm font-mono p-1 px-2 rounded',
                                            activity.amount > 0
                                                ? 'text-amber-400 bg-amber-500/10'
                                                : 'text-red-400 bg-red-500/10'
                                        )}
                                    >
                                        {activity.amount > 0 ? '+' : '-'}$
                                        {Math.abs(activity.amount).toFixed(2)}
                                    </div>
                                </motion.li>
                            ))
                        )}
                    </motion.ul>
                </motion.div>

                {/* Financial Services */}
                <motion.div variants={itemVariants}>
                    <div className="flex items-center gap-2 mb-4">
                        <Library className="w-5 h-5 text-amber-400/70" />
                        <h2 className="text-sm font-semibold text-zinc-300">Services</h2>
                    </div>
                    <motion.div
                        variants={containerVariants}
                        className="space-y-2"
                    >
                        {financialServices.map((service, index) => {
                            const isExpanded = expandedService === index;
                            const hasForm = !!service.renderForm;
                            const accent = actionAccents[index % actionAccents.length];

                            return (
                                <motion.div
                                    key={index}
                                    variants={itemVariants}
                                    layout
                                    className={cn(
                                        "rounded-xl border border-zinc-800/80 bg-zinc-950/35 transition-all duration-200",
                                        isExpanded && `${accent.bg} ${accent.border}`
                                    )}
                                >
                                    <motion.div
                                        whileHover={{
                                            scale: 1.01,
                                            boxShadow: '0px 8px 24px rgba(0, 0, 0, 0.25)',
                                            backgroundColor: 'rgba(255,255,255,0.03)',
                                        }}
                                        whileTap={{ scale: 0.995 }}
                                        onClick={() => {
                                            if (hasForm) {
                                                setExpandedService(isExpanded ? null : index);
                                                if (!isExpanded) setExpandedAction(null);
                                            } else {
                                                service.onClick?.();
                                            }
                                        }}
                                        className="flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200"
                                    >
                                        <div className="flex items-center gap-3">
                                            <IconWrapper
                                                icon={service.icon}
                                                className={cn("bg-zinc-800/80", accent.icon)}
                                            />
                                            <div>
                                                <p className="font-medium text-sm flex items-center gap-2 text-zinc-200">
                                                    {service.title}
                                                    {service.isPremium && (
                                                        <span className="text-xs font-semibold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-500/20">
                                                            Premium
                                                        </span>
                                                    )}
                                                </p>
                                                <p className="text-xs text-zinc-500">
                                                    {service.description}
                                                </p>
                                            </div>
                                        </div>
                                        {hasForm ? (
                                            isExpanded ? (
                                                <ChevronDown className="w-5 h-5 text-amber-500/50" />
                                            ) : (
                                                <ChevronRight className="w-5 h-5 text-amber-500/50" />
                                            )
                                        ) : service.hasAction ? (
                                            <ChevronRight className="w-5 h-5 text-amber-500/50" />
                                        ) : null}
                                    </motion.div>

                                    {/* Inline Form */}
                                    <AnimatePresence>
                                        {isExpanded && service.renderForm && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0, y: -4, scale: 0.99 }}
                                                animate={{ height: 'auto', opacity: 1, y: 0, scale: 1 }}
                                                exit={{ height: 0, opacity: 0, y: -4, scale: 0.99 }}
                                                transition={{ duration: 0.24, ease: "easeOut" }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-4 pb-4 space-y-3 bg-zinc-950/30">
                                                    {service.renderForm()}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </motion.div>
                </motion.div>
            </div>
        </motion.div>
    );
};
