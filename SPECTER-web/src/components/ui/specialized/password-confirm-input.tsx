import * as React from "react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface PasswordConfirmInputProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  passwordToMatch: string;
  value: string;
  onChange: (value: string) => void;
  inputPlaceholder?: string;
}

const PasswordConfirmInput = React.forwardRef<
  HTMLDivElement,
  PasswordConfirmInputProps
>(
  (
    {
      passwordToMatch,
      value,
      onChange,
      inputPlaceholder = "Confirm password",
      className,
      ...props
    },
    ref,
  ) => {
    const [shake, setShake] = useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (
        value.length >= passwordToMatch.length &&
        e.target.value.length > value.length
      ) {
        setShake(true);
      } else {
        onChange(e.target.value);
      }
    };

    useEffect(() => {
      if (shake) {
        const timer = setTimeout(() => setShake(false), 500);
        return () => clearTimeout(timer);
      }
    }, [shake]);

    const getLetterStatus = (letter: string, index: number) => {
      if (!value[index]) return "";
      return value[index] === letter
        ? "bg-emerald-500/25"
        : "bg-red-500/25";
    };

    const passwordsMatch = passwordToMatch === value && value.length > 0;

    const bounceAnimation = {
      x: shake ? [-8, 8, -8, 8, 0] : 0,
      transition: { duration: 0.4 },
    };

    const matchAnimation = {
      scale: passwordsMatch ? [1, 1.03, 1] : 1,
      transition: { duration: 0.3 },
    };

    const borderColor = passwordsMatch
      ? "hsl(var(--success))"
      : "hsl(var(--border))";

    return (
      <div
        ref={ref}
        className={cn("flex w-full flex-col items-start justify-center", className)}
        {...props}
      >
        <span className="text-xs font-medium text-muted-foreground mb-1.5">
          Re-type your password
        </span>

        <motion.div
          className="mb-3 h-11 w-full rounded-lg border-2 bg-muted/30 px-2 py-1.5"
          animate={{
            ...bounceAnimation,
            ...matchAnimation,
            borderColor,
          }}
        >
          <div className="relative h-full w-fit overflow-hidden rounded-md">
            <div className="z-10 flex h-full items-center justify-center bg-transparent px-0 py-0.5 tracking-[0.15em]">
              {passwordToMatch.split("").map((_, index) => (
                <div
                  key={index}
                  className="flex h-full w-3.5 shrink-0 items-center justify-center"
                >
                  <span className="size-[5px] rounded-full bg-foreground/60" />
                </div>
              ))}
            </div>
            <div className="absolute inset-0 z-0 flex h-full w-full items-center justify-start">
              {passwordToMatch.split("").map((letter, index) => (
                <motion.div
                  key={index}
                  className={cn(
                    "absolute h-full w-3.5 transition-all duration-300 ease-out",
                    getLetterStatus(letter, index),
                  )}
                  style={{
                    left: `${index * 14}px`,
                    scaleX: value[index] ? 1 : 0,
                    transformOrigin: "left",
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          className="h-11 w-full overflow-hidden rounded-lg"
          animate={matchAnimation}
        >
          <motion.input
            className="h-full w-full rounded-lg border-2 bg-background px-3 py-2 text-sm tracking-[0.3em] text-foreground outline-none placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary"
            type="password"
            placeholder={inputPlaceholder}
            value={value}
            onChange={handleInputChange}
            animate={{ borderColor }}
          />
        </motion.div>
      </div>
    );
  },
);

PasswordConfirmInput.displayName = "PasswordConfirmInput";

export { PasswordConfirmInput };
