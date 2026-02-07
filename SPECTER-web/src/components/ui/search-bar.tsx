"use client";

import type React from "react";
import { useState, useRef, useEffect } from "react";
import { Search, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  placeholder?: string;
  onSearch?: (query: string) => void;
  /** Optional suggestions; pass [] or omit to hide dropdown */
  suggestions?: string[];
  /** Larger, full-width variant for Send page */
  variant?: "default" | "minimal";
  /** Controlled value – when provided, input shows this; use with onChange */
  value?: string;
  /** Called when input value changes (for controlled mode) */
  onChange?: (value: string) => void;
}

const SearchBar = ({
  placeholder = "Search...",
  onSearch,
  suggestions: suggestionsProp = [],
  variant = "minimal",
  value: controlledValue,
  onChange: controlledOnChange,
}: SearchBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalQuery, setInternalQuery] = useState("");
  const searchQuery = controlledValue !== undefined ? controlledValue : internalQuery;
  const setSearchQuery = (v: string) => {
    if (controlledValue !== undefined) {
      controlledOnChange?.(v);
    } else {
      setInternalQuery(v);
    }
  };
  const [isFocused, setIsFocused] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const showSuggestions = suggestionsProp.length > 0;

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (showSuggestions && value.trim()) {
      setFilteredSuggestions(
        suggestionsProp.filter((item) =>
          item.toLowerCase().includes(value.toLowerCase())
        )
      );
    } else {
      setFilteredSuggestions([]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSearch && searchQuery.trim()) {
      onSearch(searchQuery.trim());
    }
  };

  const pickSuggestion = (s: string) => {
    setSearchQuery(s);
    onSearch?.(s);
    setFilteredSuggestions([]);
  };

  return (
    <div className="relative w-full">
      <motion.form
        onSubmit={handleSubmit}
        className={cn(
          "relative flex items-center w-full rounded-2xl border bg-background/50 backdrop-blur-sm transition-all duration-200",
          "border-border hover:border-muted-foreground/30",
          isFocused && "border-primary/40 ring-2 ring-primary/10 bg-background/80",
          variant === "minimal" && "px-5 py-4"
        )}
      >
        <Search
          className={cn(
            "shrink-0 text-muted-foreground transition-colors",
            isFocused ? "text-primary" : "text-muted-foreground",
            variant === "minimal" ? "h-6 w-6 mr-4" : "h-5 w-5 mr-3"
          )}
          strokeWidth={1.8}
        />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onChange={handleSearch}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          className={cn(
            "flex-1 min-w-0 py-2 bg-transparent outline-none placeholder:text-muted-foreground/70 text-foreground font-medium",
            variant === "minimal" ? "text-lg" : "text-base"
          )}
        />
        <AnimatePresence>
          {searchQuery.trim() && (
            <motion.button
              type="submit"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "shrink-0 rounded-full p-2 text-primary hover:bg-primary/10 transition-colors",
                variant === "minimal" && "p-2.5"
              )}
              aria-label="Submit"
            >
              <ArrowRight className="h-5 w-5" strokeWidth={2} />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.form>

      <AnimatePresence>
        {isFocused && showSuggestions && filteredSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-10 w-full mt-2 rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-lg overflow-hidden"
          >
            <ul className="py-2 max-h-[240px] overflow-y-auto">
              {filteredSuggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="w-full px-5 py-2.5 text-left text-sm hover:bg-muted/60 transition-colors flex items-center gap-3"
                  >
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export { SearchBar };
