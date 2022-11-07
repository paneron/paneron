declare module "react-visual-diff" {
  const VisualDiff: React.FC<{
    left: JSX.Element
    right: JSX.Element
    renderChange?: React.FC<{ type: 'added' | 'removed' }>
    diffProps?: string[]
  }>
  export = VisualDiff
}
