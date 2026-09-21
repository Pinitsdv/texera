// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import sbt._
import com.typesafe.sbt.packager.archetypes.JavaAppPackaging
import com.typesafe.sbt.packager.archetypes.JavaAppPackaging.autoImport._
import com.typesafe.sbt.packager.archetypes.scripts.BashStartScriptPlugin
import com.typesafe.sbt.packager.archetypes.scripts.BashStartScriptPlugin.autoImport._

/**
  * Makes the generated bash launchers start on Windows.
  *
  * The sbt-native-packager launcher lists every jar on the classpath one by
  * one. With 300+ jars that string runs past 46k characters, which exceeds
  * Windows' 32767-character command-line limit, so services died at startup
  * with "Argument list too long". A lib_dir wildcard keeps it short on every
  * platform.
  *
  * The redefined fix_classpath covers Git Bash: the stock launcher converts the
  * classpath to Windows form only when it detects Cygwin, but Git Bash reports
  * itself as MINGW64, so the conversion never ran and Java could not find the
  * classes. Guarding on cygpath's presence keeps it a no-op on Linux and macOS.
  * It is defined after the stock one, so it is the one bash calls.
  *
  * An AutoPlugin rather than a shared settings Seq: these keys only exist where
  * JavaAppPackaging is enabled, and the library modules that share the common
  * settings do not enable it.
  */
object WindowsLauncherPlugin extends AutoPlugin {
  // BashStartScriptPlugin must come first too: it initialises the extra
  // defines to an empty list, which would discard anything appended before it.
  override def requires: Plugins = JavaAppPackaging && BashStartScriptPlugin
  override def trigger: PluginTrigger = allRequirements

  override def projectSettings: Seq[Setting[_]] =
    Seq(
      scriptClasspath := Seq("*"),
      bashScriptExtraDefines +=
        """fix_classpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -wp "$1"; else echo "$1"; fi; }"""
    )
}
