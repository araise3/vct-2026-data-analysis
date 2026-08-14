import { tv } from 'tailwind-variants'

const badge = tv({
  base: 'inline-flex items-center justify-center rounded-2xl text-[11px] font-bold leading-none px-2 py-1',
  variants: {
    tone: {
      accent: 'bg-grad-accent text-white shadow-[0_2px_6px_-1px_rgb(255_70_85_/_0.5),inset_0_1px_0_0_rgb(255_255_255_/_0.2)]',
      neutral: 'bg-surface2 text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.06)]',
    },
  },
  defaultVariants: { tone: 'accent' },
})

export default function Badge({ tone, className, ...props }) {
  return <span className={badge({ tone, className })} {...props} />
}
