import { createContext, type ComponentType } from "react";
import { SiteHeader, type HeaderProps } from "../../components/SiteHeader";
import { HeaderPreprint, HomePreprint } from "./HomePreprint";
import { HeaderStamp, HomeStamp } from "./HomeStamp";
import { HomeCanon } from "./HomeCanon";

/* The candidate designs of the website while one is being chosen. Each has its
 * own header and homepage. The notes use the shared components everywhere,
 * restyled by the design's stylesheet in src/everything-ui/looks. Once a design
 * is chosen, it becomes the only one and this file goes away. */

export type LookId = "canon" | "stamp" | "preprint";

export interface HomeProps {
  showInstall: boolean;
}

export const VARIANTS: Record<LookId, { Header: ComponentType<HeaderProps>; Home: ComponentType<HomeProps> }> = {
  canon: { Header: SiteHeader, Home: HomeCanon },
  stamp: { Header: HeaderStamp, Home: HomeStamp },
  preprint: { Header: HeaderPreprint, Home: HomePreprint },
};

/** Which design the site renders. The live site uses the default; Storybook
 *  provides the design picked in its toolbar. */
export const LookContext = createContext<LookId>("canon");
