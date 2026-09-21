/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { ChangeDetectorRef, Component } from "@angular/core";
import Fuse from "fuse.js";
import { OperatorMetadataService } from "../../../service/operator-metadata/operator-metadata.service";
import { GroupInfo, OperatorSchema } from "../../../types/operator-schema.interface";
import { DragDropService } from "../../../service/drag-drop/drag-drop.service";
import { WorkflowActionService } from "../../../service/workflow-graph/model/workflow-action.service";
import { WorkflowUtilService } from "../../../service/workflow-graph/util/workflow-util.service";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { merge } from "rxjs";
import {
  NzAutocompleteOptionComponent,
  NzAutocompleteTriggerDirective,
  NzAutocompleteComponent,
} from "ng-zorro-antd/auto-complete";
import { NzSpaceCompactItemDirective } from "ng-zorro-antd/space";
import { NzInputDirective } from "ng-zorro-antd/input";
import { FormsModule } from "@angular/forms";
import { NgFor, NgIf, NgTemplateOutlet } from "@angular/common";
import { OperatorLabelComponent } from "./operator-label/operator-label.component";
import { NzCollapseComponent, NzCollapsePanelComponent } from "ng-zorro-antd/collapse";
import { NextOperatorService } from "../../../service/next-operator/next-operator.service";

@UntilDestroy()
@Component({
  selector: "texera-operator-menu",
  templateUrl: "operator-menu.component.html",
  styleUrls: ["operator-menu.component.scss"],
  imports: [
    NzSpaceCompactItemDirective,
    NzInputDirective,
    FormsModule,
    NzAutocompleteTriggerDirective,
    NzAutocompleteComponent,
    NgFor,
    NgIf,
    NzAutocompleteOptionComponent,
    OperatorLabelComponent,
    NgTemplateOutlet,
    NzCollapseComponent,
    NzCollapsePanelComponent,
  ],
})
export class OperatorMenuComponent {
  public opList = new Map<string, Array<OperatorSchema>>();
  public groupNames: ReadonlyArray<GroupInfo> = [];

  // input value of the search input box
  public searchInputValue: string = "";
  // search autocomplete suggestion list
  public autocompleteOptions: OperatorSchema[] = [];

  public canModify = true;

  // The operator the canvas has selected, and what is worth adding after it.
  public selectedOperatorName = "";
  public nextSuggestions: OperatorSchema[] = [];
  // Shown instead of the list when an operator ends the workflow, so an empty
  // panel is never mistaken for a broken one.
  public nextStepNote = "";
  private selectedOperatorId: string | null = null;

  // fuzzy search using fuse.js. See parameters in options at https://fusejs.io/
  public fuse = new Fuse([] as ReadonlyArray<OperatorSchema>, {
    shouldSort: true,
    threshold: 0.3,
    location: 0,
    distance: 100,
    minMatchCharLength: 1,
    keys: ["additionalMetadata.userFriendlyName"],
  });

  constructor(
    private operatorMetadataService: OperatorMetadataService,
    private workflowActionService: WorkflowActionService,
    private workflowUtilService: WorkflowUtilService,
    private dragDropService: DragDropService,
    private nextOperatorService: NextOperatorService,
    private changeDetectorRef: ChangeDetectorRef
  ) {
    // clear the search box if an operator is dropped from operator search box
    this.dragDropService.operatorDropStream.pipe(untilDestroyed(this)).subscribe(() => {
      this.searchInputValue = "";
      this.autocompleteOptions = [];
    });
    this.workflowActionService
      .getWorkflowModificationEnabledStream()
      .pipe(untilDestroyed(this))
      .subscribe(canModify => (this.canModify = canModify));
    this.operatorMetadataService
      .getOperatorMetadata()
      .pipe(untilDestroyed(this))
      .subscribe(operatorMetadata => {
        const ops = operatorMetadata.operators.filter(
          operatorSchema => operatorSchema.operatorType !== "PythonUDF" && operatorSchema.operatorType !== "Dummy"
        );
        this.groupNames = operatorMetadata.groups;
        ops.forEach(x => {
          if (x.operatorType !== "Sleep") {
            const group = x.additionalMetadata.operatorGroupName;
            const list = this.opList.get(group) || [];
            list.push(x);
            this.opList.set(group, list);
          }
        });
        this.opList.forEach(value => {
          value.sort((a, b) => a.operatorType.localeCompare(b.operatorType));
        });
        this.fuse.setCollection(ops);
      });

    // Both streams report only the operators that just changed, so read the
    // whole selection each time: selecting a second operator would otherwise
    // look like selecting one, and clearing the selection would go unnoticed.
    const wrapper = this.workflowActionService.getJointGraphWrapper();
    merge(wrapper.getJointOperatorHighlightStream(), wrapper.getJointOperatorUnhighlightStream())
      .pipe(untilDestroyed(this))
      .subscribe(() => this.updateSuggestions(wrapper.getCurrentHighlightedOperatorIDs()));
  }

  /**
   * Offers a next step for a single selected operator. A multi-selection has no
   * one "after", and an empty selection nothing to follow, so both clear.
   */
  private updateSuggestions(selectedIds: readonly string[]): void {
    const graph = this.workflowActionService.getTexeraGraph();
    const schema =
      selectedIds.length === 1 && graph.hasOperator(selectedIds[0])
        ? this.schemaOf(graph.getOperator(selectedIds[0]).operatorType)
        : undefined;

    if (schema === undefined) {
      this.selectedOperatorId = null;
      this.selectedOperatorName = "";
      this.nextSuggestions = [];
      this.nextStepNote = "";
      // The highlight stream fires from JointJS events, outside Angular's zone.
      this.changeDetectorRef.detectChanges();
      return;
    }

    const operatorId = selectedIds[0];
    this.selectedOperatorId = operatorId;
    this.selectedOperatorName =
      graph.getOperator(operatorId).customDisplayName ?? schema.additionalMetadata.userFriendlyName;

    this.nextOperatorService.suggestionsFor(schema.additionalMetadata.operatorGroupName).then(result => {
      // The selection may have moved on while the rules were loading.
      if (this.selectedOperatorId !== operatorId) {
        return;
      }
      this.nextSuggestions = result.suggestions;
      this.nextStepNote =
        result.suggestions.length > 0
          ? ""
          : result.known
            ? "Nothing usually follows this — it ends the workflow."
            : "No suggestions for this group yet.";
      this.changeDetectorRef.detectChanges();
    });
  }

  /**
   * Places a suggested operator to the right of the selected one and wires them
   * together, as one undoable step — the point is to skip the search entirely.
   */
  public addNext(schema: OperatorSchema): void {
    const operatorId = this.selectedOperatorId;
    if (operatorId === null || !this.canModify) {
      return;
    }

    const newOperator = this.workflowUtilService.getNewOperatorPredicate(schema.operatorType);
    const anchor = this.workflowActionService.getJointGraphWrapper().getElementPosition(operatorId);
    const position = { x: anchor.x + 220, y: anchor.y };

    const source = this.workflowActionService.getTexeraGraph().getOperator(operatorId).outputPorts[0];
    const target = newOperator.inputPorts[0];
    // A source operator has no input and a sink no output; without both ends
    // there is nothing to connect, so place it and let the user wire it.
    const links =
      source && target
        ? [
            {
              linkID: this.workflowUtilService.getLinkRandomUUID(),
              source: { operatorID: operatorId, portID: source.portID },
              target: { operatorID: newOperator.operatorID, portID: target.portID },
            },
          ]
        : [];

    this.workflowActionService.addOperatorsAndLinks([{ op: newOperator, pos: position }], links);

    // Adding an operator leaves nothing selected, which would close this panel
    // after a single use. Selecting what was just placed keeps the chain going:
    // the panel immediately offers what comes after it.
    this.workflowActionService.getJointGraphWrapper().highlightOperators(newOperator.operatorID);
  }

  /** The schema for an operator type, or undefined for a type the metadata does not know. */
  private schemaOf(operatorType: string): OperatorSchema | undefined {
    try {
      return this.operatorMetadataService.getOperatorSchema(operatorType);
    } catch {
      return undefined;
    }
  }

  /**
   * create the search results observable
   * whenever the search box text is changed, perform the search using fuse.js
   */
  onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === null || v.trim().length === 0) {
      this.autocompleteOptions = [];
    }
    this.autocompleteOptions = this.fuse.search(v).map(item => {
      return item.item;
    });
  }

  /**
   * handles the event when an operator search option is selected.
   * adds the operator to the canvas and clears the text in the search box
   */
  onSelectionChange(e: NzAutocompleteOptionComponent): void {
    const selectSchema = e.nzValue as OperatorSchema;
    // add the operator to the graph on select (position relative to the current viewpoint)
    const origin = this.workflowActionService.getJointGraphWrapper().getMainJointPaper()?.translate();
    const point = { x: 400 - (origin?.tx ?? 0), y: 200 - (origin?.ty ?? 0) };
    this.workflowActionService.addOperator(
      this.workflowUtilService.getNewOperatorPredicate(selectSchema.operatorType),
      point
    );

    // asynchronously immediately clear the search input and suggestions
    // because ng-zorro shows the selected value if it's synchronously
    setTimeout(() => {
      this.searchInputValue = "";
      this.autocompleteOptions = [];
    }, 0);
  }
}
