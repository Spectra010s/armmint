"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
export function SignOutButton(){const[busy,setBusy]=useState(false);async function signOut(){setBusy(true);try{const result=await authClient.signOut();if(result.error)throw new Error();window.location.assign("/");}catch{setBusy(false)}}return <button type="button" disabled={busy} onClick={signOut} className="text-xs font-medium text-neutral-500 hover:text-white disabled:opacity-50">{busy?"Signing out…":"Sign out"}</button>}
