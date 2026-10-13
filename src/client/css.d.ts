/** Ambient type for the CSS-module import used only for class names. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export = classes
}
