import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

export interface Step {
    id: string;
    title: string;
    description: string;
    tooltip: string;
    completed?: boolean;
}

interface EnsStepGuideProps {
    steps: Step[];
    currentStep: number;
    onStepChange: (step: number) => void;
}

export function EnsStepGuide({ steps, currentStep, onStepChange }: EnsStepGuideProps) {
    const canGoPrevious = currentStep > 0;
    const canGoNext = currentStep < steps.length - 1;
    const currentStepData = steps[currentStep];

    return (
        <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6 mb-8"
        >
            <div className="space-y-6">
                {/* Progress Bar */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-muted-foreground">
                            Step {currentStep + 1} of {steps.length}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                            {Math.round(((currentStep + 1) / steps.length) * 100)}% Complete
                        </span>
                    </div>

                    <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_100%]"
                            initial={{ width: 0 }}
                            animate={{
                                width: `${((currentStep + 1) / steps.length) * 100}%`,
                                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%']
                            }}
                            transition={{
                                width: { duration: 0.5, ease: "easeOut" },
                                backgroundPosition: {
                                    duration: 3,
                                    repeat: Infinity,
                                    ease: "linear"
                                }
                            }}
                        />
                    </div>

                    {/* Step Indicators */}
                    <div className="flex items-center justify-between">
                        {steps.map((step, index) => {
                            const isActive = index === currentStep;
                            const isCompleted = step.completed || index < currentStep;

                            return (
                                <TooltipProvider key={step.id}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                onClick={() => onStepChange(index)}
                                                className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${isActive
                                                        ? "border-primary bg-primary text-primary-foreground scale-110"
                                                        : isCompleted
                                                            ? "border-success bg-success/10 text-success"
                                                            : "border-muted-foreground/30 bg-muted text-muted-foreground hover:border-primary/50"
                                                    }`}
                                            >
                                                {isCompleted && !isActive ? (
                                                    <Check className="h-5 w-5" />
                                                ) : (
                                                    <span className="text-sm font-bold">{index + 1}</span>
                                                )}

                                                {isActive && (
                                                    <motion.div
                                                        className="absolute inset-0 rounded-full border-2 border-primary"
                                                        initial={{ scale: 1, opacity: 1 }}
                                                        animate={{ scale: 1.5, opacity: 0 }}
                                                        transition={{ duration: 1.5, repeat: Infinity }}
                                                    />
                                                )}
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                            <p className="text-sm font-medium">{step.title}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            );
                        })}
                    </div>
                </div>

                {/* Current Step Info */}
                <div className="p-4 rounded-lg bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/20">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                            <span className="text-sm font-bold text-primary">{currentStep + 1}</span>
                        </div>
                        <div className="flex-1">
                            <h4 className="font-display font-semibold text-lg mb-1">
                                {currentStepData.title}
                            </h4>
                            <p className="text-sm text-muted-foreground mb-3">
                                {currentStepData.description}
                            </p>

                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <button className="text-xs text-primary hover:underline">
                                            💡 Need help with this step?
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="max-w-sm">
                                        <p className="text-sm">{currentStepData.tooltip}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </div>
                </div>

                {/* Navigation Buttons */}
                <div className="flex items-center justify-between gap-4">
                    <Button
                        variant="outline"
                        onClick={() => onStepChange(currentStep - 1)}
                        disabled={!canGoPrevious}
                        className="flex-1"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Previous
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => onStepChange(currentStep + 1)}
                        disabled={!canGoNext}
                        className="flex-1"
                    >
                        Next
                        <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                </div>
            </div>
        </motion.div>
    );
}
