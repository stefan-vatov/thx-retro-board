import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

describe("shadcn Tailwind foundation", () => {
  it("exposes the shadcn utility through the @ alias", () => {
    const hidden = Boolean("");

    expect(cn("px-2 text-sm", hidden && "hidden", "px-4")).toContain("px-4");
    expect(cn("px-2 text-sm", hidden && "hidden", "px-4")).not.toContain("px-2");
  });

  it("exports app-owned shadcn-compatible primitives", () => {
    expect(Button).toBeTypeOf("function");
    expect(buttonVariants({ variant: "default" })).toContain("bg-primary");
    expect(Card).toBeTypeOf("function");
    expect(Input).toBeTypeOf("function");
    expect(Badge).toBeTypeOf("function");
    expect(Alert).toBeTypeOf("function");
    expect(Separator).toBeTypeOf("function");
  });

  it("renders Badge as its child element when asChild is provided", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Badge,
        { asChild: true, variant: "secondary" },
        createElement("a", { href: "/room/example" }, "Room link"),
      ),
    );

    expect(markup).toMatch(/^<a /);
    expect(markup).toContain('data-slot="badge"');
    expect(markup).toContain('href="/room/example"');
    expect(markup).toContain("bg-secondary");
    expect(markup).toContain("Room link");
    expect(markup).not.toContain("<span");
  });
});
