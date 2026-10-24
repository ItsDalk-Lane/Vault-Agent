import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { t } from "@/i18n";

interface PasswordInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  inputClassName,
  ariaLabel,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = value ?? "";
  }, [value]);

  return (
    <div className={cn("tw-relative", className)}>
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        type={showPassword ? "text" : "password"}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("tw-w-full !tw-pr-7", inputClassName)}
      />
      <Button
        type="button"
        variant="ghost2"
        size="icon"
        disabled={disabled}
        onClick={() => !disabled && setShowPassword(!showPassword)}
        className={cn(
          "tw-absolute tw-inset-y-0 tw-right-1 tw-my-auto tw-size-6",
          "tw-cursor-pointer",
          disabled && "tw-cursor-not-allowed tw-opacity-50"
        )}
        aria-label={showPassword ? t("ui.password.hide") : t("ui.password.show")}
      >
        {showPassword ? (
          <EyeOff
            className={cn(
              "tw-size-3.5",
              "tw-text-muted/60 hover:tw-text-accent",
              "tw-transition-colors tw-duration-200"
            )}
          />
        ) : (
          <Eye
            className={cn(
              "tw-size-3.5",
              "tw-text-muted/60 hover:tw-text-accent",
              "tw-transition-colors tw-duration-200"
            )}
          />
        )}
      </Button>
    </div>
  );
}
