// components/ui/withdrawal-card.tsx
import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface Account {
  id: string;
  initials?: string;
  icon?: React.ReactNode;
  name: string;
  details: string;
}

export interface WithdrawalCardProps {
  amount: number;
  availableBalance: number;
  currency: string;
  accounts: Account[];
  defaultSelectedAccountId: string;
  onWithdraw: (selectedAccountId: string) => void;
  className?: string;
}

export const WithdrawalCard = ({
  amount,
  availableBalance,
  currency,
  accounts,
  defaultSelectedAccountId,
  onWithdraw,
  className,
}: WithdrawalCardProps) => {
  const [selectedAccountId, setSelectedAccountId] = React.useState(defaultSelectedAccountId);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-3xl bg-card p-6 shadow-lg sm:p-8",
        "flex flex-col space-y-6 border border-border",
        className
      )}
    >
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Amount</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {currency} {formatCurrency(amount)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Available balance {currency} {formatCurrency(availableBalance)}
        </p>
      </div>

      <div className="flex-grow">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Choose Account
        </p>
        <div
          role="radiogroup"
          aria-label="Choose an account"
          className="space-y-3"
        >
          {accounts.map((account) => {
            const isSelected = selectedAccountId === account.id;
            return (
              <div
                key={account.id}
                onClick={() => setSelectedAccountId(account.id)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedAccountId(account.id)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                className={cn(
                  "relative flex cursor-pointer items-center space-x-4 rounded-xl p-4 transition-all duration-300",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted/50 hover:bg-muted"
                )}
              >
                {isSelected && (
                  <motion.div
                    layoutId="selected-highlight"
                    className="absolute inset-0 z-0 rounded-xl bg-primary"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}

                <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-background/20 text-sm font-bold">
                  <span className={cn(isSelected ? "text-primary-foreground" : "text-foreground")}>
                    {account.initials ?? account.icon}
                  </span>
                </div>

                <div className="relative z-10 flex-grow">
                  <p className="font-semibold">{account.name}</p>
                  <p className={cn("text-sm", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {account.details}
                  </p>
                </div>

                <div className="relative z-10 h-6 w-6">
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 400, damping: 20 }}
                        className="flex h-full w-full items-center justify-center rounded-full bg-primary-foreground text-primary"
                      >
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {!isSelected && <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Button
        size="lg"
        className="w-full rounded-xl py-6 text-base font-bold"
        onClick={() => onWithdraw(selectedAccountId)}
        aria-label="Withdraw amount"
      >
        WITHDRAW
      </Button>
    </div>
  );
};
