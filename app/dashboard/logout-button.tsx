"use client";

import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  return (
    <form action={signOut}>
      <Button variant="outline" size="sm" type="submit">
        <LogOut />
        Sign out
      </Button>
    </form>
  );
}
