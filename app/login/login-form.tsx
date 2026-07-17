"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, ShieldCheck } from "lucide-react";

import { signIn, signUp, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function SubmitButton({ mode }: { mode: "signin" | "signup" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {mode === "signin" ? "Sign in" : "Create account"}
    </Button>
  );
}

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction] = useActionState<AuthState, FormData>(action, null);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-3">
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <ShieldCheck className="size-6" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-xl">Ben Foods · Cert Checker</CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Sign in to manage document expiries."
              : "Create an account to get started."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@benfoods.com"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              placeholder="••••••••"
              required
            />
          </div>

          {state?.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}

          <SubmitButton mode={mode} />
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() =>
              setMode((m) => (m === "signin" ? "signup" : "signin"))
            }
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </CardContent>
    </Card>
  );
}
