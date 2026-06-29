import { type ComponentProps, forwardRef } from "react";
import clsx from "clsx";
import styles from "./Badge.module.css";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info";
type BadgeSize = "small" | "normal";

interface BadgeProps extends ComponentProps<"span"> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "default", size = "normal", className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={clsx(
          styles.badge,
          styles[`variant-${variant}`],
          styles[`size-${size}`],
          className
        )}
        data-component="badge"
        data-variant={variant}
        data-size={size}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";
