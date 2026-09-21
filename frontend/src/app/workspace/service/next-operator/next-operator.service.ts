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

/**
 * Suggests what to add after the operator the user has selected.
 *
 * Finding the next step is a different question from finding an operator by
 * name, and the semantic search cannot answer it: embeddings measure how alike
 * two things are, so asking what follows `Sort` returns `Sort Partitions` and
 * `Stable Merge Sort` — the operators most like Sort, which are precisely the
 * ones nobody wants next. Sequence is not similarity.
 *
 * So the order comes from a table instead, keyed by the group an operator
 * belongs to. Twenty-six groups cover all 166 operators, the reasoning is
 * inspectable, and it cannot invent an operator that does not exist.
 */
import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { OperatorSchema } from "../../types/operator-schema.interface";
import { OperatorMetadataService } from "../operator-metadata/operator-metadata.service";

const RULES_URL = "assets/next-operator-rules.json";

@Injectable({ providedIn: "root" })
export class NextOperatorService {
  private rules?: Record<string, string[]>;
  private operators: ReadonlyArray<OperatorSchema> = [];
  private loading?: Promise<void>;

  constructor(
    private http: HttpClient,
    private operatorMetadataService: OperatorMetadataService
  ) {}

  /**
   * What is worth adding after an operator of `afterGroup`.
   *
   * `known` separates the two reasons the list can be empty: a group the table
   * deliberately ends the workflow at, and a group nobody has written a rule
   * for yet. The palette says something different for each, because an empty
   * panel reads as a broken one.
   */
  public async suggestionsFor(afterGroup: string): Promise<{ suggestions: OperatorSchema[]; known: boolean }> {
    await this.ready();
    const names = this.rules?.[afterGroup];
    return {
      known: names !== undefined,
      suggestions: (names ?? [])
        .map(name => this.schemaByName(name))
        .filter((schema): schema is OperatorSchema => schema !== undefined),
    };
  }

  private ready(): Promise<void> {
    if (!this.loading) {
      this.loading = this.load();
    }
    return this.loading;
  }

  private async load(): Promise<void> {
    // The catalogue is what turns a name in the table into something placeable,
    // so both have to be in hand before any suggestion can be made.
    const [raw, metadata] = await Promise.all([
      firstValueFrom(this.http.get<Record<string, unknown>>(RULES_URL)),
      firstValueFrom(this.operatorMetadataService.getOperatorMetadata()),
    ]);
    this.operators = metadata.operators;
    const rules: Record<string, string[]> = {};
    for (const [group, value] of Object.entries(raw)) {
      if (!group.startsWith("_") && Array.isArray(value)) {
        rules[group] = value as string[];
      }
    }
    this.rules = rules;

    // A typo in the table silently costs a suggestion, which is hard to notice
    // and easy to say out loud.
    const unknown = Object.values(rules)
      .flat()
      .filter(name => this.schemaByName(name) === undefined);
    if (unknown.length > 0) {
      console.warn(`next-operator-rules.json names operators that do not exist: ${[...new Set(unknown)].join(", ")}`);
    }
  }

  private schemaByName(userFriendlyName: string): OperatorSchema | undefined {
    return this.operators.find(schema => schema.additionalMetadata.userFriendlyName === userFriendlyName);
  }
}
