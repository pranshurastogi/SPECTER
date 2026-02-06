import * as React from "react";
import { CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

interface FlippableCreditCardProps extends React.HTMLAttributes<HTMLDivElement> {
  cardholderName: string;
  cardNumber: string;
  expiryDate: string;
  cvv: string;
}

const FlippableCreditCard = React.forwardRef<HTMLDivElement, FlippableCreditCardProps>(
  ({ className, cardholderName, cardNumber, expiryDate, cvv, ...props }, ref) => {
    return (
      <div
        className={cn("group h-40 w-64 [perspective:1000px]", className)}
        ref={ref}
        {...props}
      >
        <div className="relative h-full w-full rounded-xl shadow-xl transition-transform duration-700 [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
          {/* Card front */}
          <div className="absolute h-full w-full rounded-xl bg-card text-card-foreground border border-border [backface-visibility:hidden]">
            <div className="relative flex h-full flex-col justify-between p-4">
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  <CreditCard className="h-5 w-5" />
                </div>
                <p className="font-display text-xs font-bold tracking-widest text-muted-foreground">
                  CARD
                </p>
              </div>
              <div className="text-center font-mono text-lg tracking-wider text-foreground">
                {cardNumber}
              </div>
              <div className="flex items-end justify-between">
                <div className="text-left">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Card Holder
                  </p>
                  <p className="font-mono text-sm font-medium">{cardholderName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Expires
                  </p>
                  <p className="font-mono text-sm font-medium">{expiryDate}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Card back */}
          <div className="absolute h-full w-full rounded-xl bg-card text-card-foreground border border-border [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="flex h-full flex-col">
              <div className="mt-6 h-10 w-full bg-muted" />
              <div className="mx-4 mt-4 flex justify-end">
                <div className="flex h-8 w-full items-center justify-end rounded-md bg-muted pr-4">
                  <p className="font-mono text-sm text-foreground">{cvv}</p>
                </div>
              </div>
              <p className="self-end pr-4 text-xs font-semibold uppercase text-muted-foreground">
                CVV
              </p>
              <div className="mt-auto p-4 text-right">
                <div className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
                  <CreditCard className="h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
FlippableCreditCard.displayName = "FlippableCreditCard";

export { FlippableCreditCard };
