import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

// One filled style for the main action on a screen, quieter ones for everything else.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none transition-[transform,opacity,background-color] duration-150 active:scale-[0.98] active:opacity-85 disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg',
        tinted: 'bg-primary-soft text-primary-text',
        gray: 'bg-fill text-ink',
        plain: 'text-primary-text',
        danger: 'bg-fill text-danger',
      },
      size: {
        sm: 'h-9 px-4 text-[0.8125rem]',
        md: 'h-11 px-5 text-[0.9375rem]',
        lg: 'h-[3.125rem] px-6 text-[1.0625rem]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  busy?: boolean
}

export function Button({ className, variant, size, asChild, busy, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
      {asChild ? children : (
        <>
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  )
}
