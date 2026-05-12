import {
  buildAutoresearchPresentationModel,
  type AutoresearchPresentationModel,
} from "../autoresearch-presentation"
import type { AutoresearchWorkspaceSnapshot } from "./data"

export type AutoresearchTuiViewModel = AutoresearchPresentationModel

export function buildAutoresearchTuiViewModel(snapshot: AutoresearchWorkspaceSnapshot): AutoresearchTuiViewModel {
  return buildAutoresearchPresentationModel(snapshot)
}