// Small design system: calm, warm neutrals with an apricot accent.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import type { Environment } from "../../shared/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand-800 text-white hover:bg-brand-900 shadow-sm shadow-brand-900/10",
    secondary: "bg-white text-stone-800 ring-1 ring-stone-200 hover:bg-stone-50 hover:ring-stone-300",
    ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  const sizes = { sm: "h-8 px-3 text-sm gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl bg-white ring-1 ring-stone-200/80 shadow-sm", className)}>{children}</div>;
}

export function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block mb-1.5">
      <span className="text-sm font-medium text-stone-800">{children}</span>
      {hint && <span className="block text-xs text-stone-500 mt-0.5">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full h-10 rounded-lg bg-white px-3 text-sm ring-1 ring-stone-200 placeholder:text-stone-400",
        "focus:outline-none focus:ring-2 focus:ring-sky-400 transition-shadow",
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "w-full h-10 rounded-lg bg-white px-3 text-sm ring-1 ring-stone-200 cursor-pointer",
        "focus:outline-none focus:ring-2 focus:ring-sky-400",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "apricot";
const tones: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700",
  green: "bg-lime-50 text-lime-800 ring-1 ring-lime-300/70",
  amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/70",
  red: "bg-red-50 text-red-700 ring-1 ring-red-200/70",
  blue: "bg-sky-50 text-sky-700 ring-1 ring-sky-200/70",
  apricot: "bg-brand-50 text-brand-700 ring-1 ring-brand-200/70",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EnvBadge({ env }: { env: Environment }) {
  return env === "production" ? (
    <Badge tone="red">● Production</Badge>
  ) : (
    <Badge tone="blue">● Sandbox</Badge>
  );
}

export function Callout({ tone = "neutral", icon, title, children }: { tone?: Tone; icon?: ReactNode; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cx("flex gap-3 rounded-xl p-4 text-sm", tones[tone])}>
      {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
      <div className="min-w-0">
        {title && <div className="font-medium mb-0.5">{title}</div>}
        {children && <div className="opacity-90 leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-stone-500">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function Progress({ value, tone = "apricot" }: { value: number; tone?: "apricot" | "green" }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-stone-100 overflow-hidden">
      <div
        className={cx("h-full rounded-full transition-[width] duration-300", tone === "green" ? "bg-lime-500" : "bg-brand-700")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-stone-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 mb-8 flex-wrap">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cx(
              "flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-sm transition-colors",
              i === current ? "bg-brand-100 text-brand-900 font-medium" : i < current ? "text-stone-700" : "text-stone-400",
            )}
          >
            <span
              className={cx(
                "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                i === current ? "bg-brand-800 text-white" : i < current ? "bg-lime-500 text-brand-900" : "bg-stone-200 text-stone-500",
              )}
            >
              {i < current ? "✓" : i + 1}
            </span>
            {s}
          </span>
          {i < steps.length - 1 && <span className="w-6 h-px bg-stone-200" />}
        </li>
      ))}
    </ol>
  );
}

/** "1 file", "3 files" */
export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
