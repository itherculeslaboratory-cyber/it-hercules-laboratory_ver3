import type { ComponentType } from "react";

const nodeRegistry = new Map<string, ComponentType<any>>();

export function registerNode(key: string, component: ComponentType<any>): void {
  nodeRegistry.set(key, component);
}

export function lookupNode(key: string): ComponentType<any> | undefined {
  return nodeRegistry.get(key);
}

export function registrySize(): number {
  return nodeRegistry.size;
}
