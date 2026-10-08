// Puts planData.json into the page template and writes output/plan.html, the
// file that is published as the plan page.
import { readFileSync, writeFileSync } from "fs";

const dir = import.meta.dir;
const template = readFileSync(`${dir}/plan.template.html`, "utf8");
// "</" inside a string would end the script tag early, so it is escaped.
const data = readFileSync(`${dir}/output/planData.json`, "utf8").replaceAll("</", "<\\/");
writeFileSync(`${dir}/output/plan.html`, template.replace("/*PLAN_DATA*/", () => data));
console.log("wrote output/plan.html");
