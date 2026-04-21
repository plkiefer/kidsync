"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "action" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconOnly?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
}

// variant → CSS class defined in globals.css
const variantClass: Record<Variant, string> = {
  primary: "btn-primary", // ink — text-level emphasis
  action:  "btn-action",  // cerulean — "you can do something here"
  outline: "btn-outline", // paper + stone border
  ghost:   "btn-ghost",   // no chrome
};

const sizeClass: Record<Size, string> = {
  sm: "text-[12.5px] px-2.5 py-1.5",
  md: "text-[13.5px] px-3.5 py-1.5",
  lg: "text-sm px-4 py-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      iconOnly = false,
      leadingIcon,
      trailingIcon,
      className = "",
      children,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    const iconOnlyClass = iconOnly ? "!px-1.5 !py-1.5" : "";
    return (
      <button
        ref={ref}
        type={type}
        className={[
          "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
          variantClass[variant],
          sizeClass[size],
          iconOnlyClass,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {leadingIcon}
        {children}
        {trailingIcon}
      </button>
    );
  },
);

Button.displayName = "Button";
