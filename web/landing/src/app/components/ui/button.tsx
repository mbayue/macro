import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[0.8125rem] font-medium whitespace-nowrap no-underline transition-[background-color,color,border-color,transform] duration-150 select-none cursor-pointer focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:outline-[2px] aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary:
          'bg-secondary text-secondary-foreground hover:border-bar-hover aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        outline:
          'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground hover:border-bar-hover aria-expanded:bg-accent aria-expanded:text-accent-foreground',
        ghost:
          'bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground',
        destructive:
          'border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-destructive',
        link: 'h-auto rounded-sm px-0 text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-11 gap-2 px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        icon: 'size-10',
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
