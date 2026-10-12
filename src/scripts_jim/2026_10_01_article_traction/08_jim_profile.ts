/** Experiment 8: how many accounts does @JimMaar1 follow? One user read, $0.01. */
import { xGet } from "./x";

const me = await xGet("/2/users/me", { "user.fields": "public_metrics" }, "user", "08_jim_profile");
console.log(me.status, JSON.stringify(me.body.data?.public_metrics));
