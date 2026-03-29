// Type declaration for the Wistia web component
// React 19 uses the global JSX namespace
declare global {
  namespace React.JSX {
    interface IntrinsicElements {
      "wistia-player": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "media-id"?: string;
          seo?: string;
          aspect?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
