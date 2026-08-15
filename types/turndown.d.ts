declare module "turndown" {
  interface TurndownOptions {
    headingStyle?: "setext" | "atx";
    bulletListMarker?: "-" | "+" | "*";
    codeBlockStyle?: "indented" | "fenced";
  }

  type Filter = string | string[] | ((node: Node, options: TurndownOptions) => boolean);

  export default class TurndownService {
    constructor(options?: TurndownOptions);
    turndown(input: string | Node): string;
    remove(filter: Filter): this;
  }
}
