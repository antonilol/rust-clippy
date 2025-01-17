(function () {
    const md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        highlight: function (str, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return '<pre class="hljs"><code>' +
                        hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                        '</code></pre>';
                } catch (__) {}
            }

            return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
        }
    });

    function scrollToLint(lintId) {
        const target = document.getElementById(lintId);
        if (!target) {
            return;
        }
        target.scrollIntoView();
    }

    function scrollToLintByURL($scope, $location) {
        const removeListener = $scope.$on('ngRepeatFinished', function (ngRepeatFinishedEvent) {
            scrollToLint($location.path().substring(1));
            removeListener();
        });
    }

    function selectGroup($scope, selectedGroup) {
        const groups = $scope.groups;
        for (const group in groups) {
            if (groups.hasOwnProperty(group)) {
                groups[group] = group === selectedGroup;
            }
        }
    }

    angular.module("clippy", [])
        .filter('markdown', function ($sce) {
            return function (text) {
                return $sce.trustAsHtml(
                    md.render(text || '')
                        // Oh deer, what a hack :O
                        .replace('<table', '<table class="table"')
                );
            };
        })
        .directive('filterDropdown', function ($document) {
            return {
                restrict: 'A',
                link: function ($scope, $element, $attr) {
                    $element.bind('click', function (event) {
                        if (event.target.closest('button')) {
                            $element.toggleClass('open');
                        } else {
                            $element.addClass('open');
                        }
                        $element.addClass('open-recent');
                    });

                    $document.bind('click', function () {
                        if (!$element.hasClass('open-recent')) {
                            $element.removeClass('open');
                        }
                        $element.removeClass('open-recent');
                    })
                }
            }
        })
        .directive('onFinishRender', function ($timeout) {
            return {
                restrict: 'A',
                link: function (scope, element, attr) {
                    if (scope.$last === true) {
                        $timeout(function () {
                            scope.$emit(attr.onFinishRender);
                        });
                    }
                }
            };
        })
        .controller("lintList", function ($scope, $http, $location, $timeout) {
            // Level filter
            const LEVEL_FILTERS_DEFAULT = {allow: true, warn: true, deny: true, none: true};
            $scope.levels = { ...LEVEL_FILTERS_DEFAULT };
            $scope.byLevels = function (lint) {
                return $scope.levels[lint.level];
            };

            const GROUPS_FILTER_DEFAULT = {
                cargo: true,
                complexity: true,
                correctness: true,
                deprecated: false,
                nursery: true,
                pedantic: true,
                perf: true,
                restriction: true,
                style: true,
                suspicious: true,
            }

            $scope.groups = {
                ...GROUPS_FILTER_DEFAULT
            };

            $scope.versionFilters = {
                "≥": {enabled: false, minorVersion: null },
                "≤": {enabled: false, minorVersion: null },
                "=": {enabled: false, minorVersion: null },
            };

            // Map the versionFilters to the query parameters in a way that is easier to work with in a URL
            const versionFilterKeyMap = {
                "≥": "gte",
                "≤": "lte",
                "=": "eq"
            };
            const reverseVersionFilterKeyMap = Object.fromEntries(
                Object.entries(versionFilterKeyMap).map(([key, value]) => [value, key])
            );

            const APPLICABILITIES_FILTER_DEFAULT = {
                Unspecified: true,
                Unresolved: true,
                MachineApplicable: true,
                MaybeIncorrect: true,
                HasPlaceholders: true
            };

            $scope.applicabilities = {
                ...APPLICABILITIES_FILTER_DEFAULT
            }

            // loadFromURLParameters retrieves filter settings from the URL parameters and assigns them
            // to corresponding $scope variables.
            function loadFromURLParameters() {
                // Extract parameters from URL
                const urlParameters = $location.search();

                // Define a helper function that assigns URL parameters to a provided scope variable
                const handleParameter = (parameter, scopeVariable, defaultValues) => {
                    if (urlParameters[parameter]) {
                        const items = urlParameters[parameter].split(',');
                        for (const key in scopeVariable) {
                            if (scopeVariable.hasOwnProperty(key)) {
                                scopeVariable[key] = items.includes(key);
                            }
                        }
                    } else if (defaultValues) {
                        for (const key in defaultValues) {
                            if (scopeVariable.hasOwnProperty(key)) {
                                scopeVariable[key] = defaultValues[key];
                            }
                        }
                    }
                };

                handleParameter('levels', $scope.levels, LEVEL_FILTERS_DEFAULT);
                handleParameter('groups', $scope.groups, GROUPS_FILTER_DEFAULT);
                handleParameter('applicabilities', $scope.applicabilities, APPLICABILITIES_FILTER_DEFAULT);

                // Handle 'versions' parameter separately because it needs additional processing
                if (urlParameters.versions) {
                    const versionFilters = urlParameters.versions.split(',');
                    for (const versionFilter of versionFilters) {
                        const [key, minorVersion] = versionFilter.split(':');
                        const parsedMinorVersion = parseInt(minorVersion);

                        // Map the key from the URL parameter to its original form
                        const originalKey = reverseVersionFilterKeyMap[key];

                        if (originalKey in $scope.versionFilters && !isNaN(parsedMinorVersion)) {
                            $scope.versionFilters[originalKey].enabled = true;
                            $scope.versionFilters[originalKey].minorVersion = parsedMinorVersion;
                        }
                    }
                }

                // Load the search parameter from the URL path
                const searchParameter = $location.path().substring(1); // Remove the leading slash
                if (searchParameter) {
                    $scope.search = searchParameter;
                    $scope.open[searchParameter] = true;
                    scrollToLintByURL($scope, $location);
                }
            }

            // updateURLParameter updates the URL parameter with the given key to the given value
            function updateURLParameter(filterObj, urlKey, defaultValue = {}, processFilter = filter => filter) {
                const parameter = Object.keys(filterObj)
                    .filter(filter => filterObj[filter])
                    .sort()
                    .map(processFilter)
                    .filter(Boolean) // Filters out any falsy values, including null
                    .join(',');

                const defaultParameter = Object.keys(defaultValue)
                    .filter(filter => defaultValue[filter])
                    .sort()
                    .map(processFilter)
                    .filter(Boolean) // Filters out any falsy values, including null
                    .join(',');

                // if we ended up back at the defaults, just remove it from the URL
                if (parameter === defaultParameter) {
                    $location.search(urlKey, null);
                } else {
                    $location.search(urlKey, parameter || null);
                }
            }

            // updateVersionURLParameter updates the version URL parameter with the given version filters
            function updateVersionURLParameter(versionFilters) {
                updateURLParameter(
                    versionFilters,
                    'versions', {},
                    versionFilter => versionFilters[versionFilter].enabled && versionFilters[versionFilter].minorVersion != null
                        ? `${versionFilterKeyMap[versionFilter]}:${versionFilters[versionFilter].minorVersion}`
                        : null
                );
            }

            // updateAllURLParameters updates all the URL parameters with the current filter settings
            function updateAllURLParameters() {
                updateURLParameter($scope.levels, 'levels', LEVEL_FILTERS_DEFAULT);
                updateURLParameter($scope.groups, 'groups', GROUPS_FILTER_DEFAULT);
                updateVersionURLParameter($scope.versionFilters);
                updateURLParameter($scope.applicabilities, 'applicabilities', APPLICABILITIES_FILTER_DEFAULT);
            }

            // Add $watches to automatically update URL parameters when the data changes
            $scope.$watch('levels', function (newVal, oldVal) {
                if (newVal !== oldVal) {
                    updateURLParameter(newVal, 'levels', LEVEL_FILTERS_DEFAULT);
                }
            }, true);

            $scope.$watch('groups', function (newVal, oldVal) {
                if (newVal !== oldVal) {
                    updateURLParameter(newVal, 'groups', GROUPS_FILTER_DEFAULT);
                }
            }, true);

            $scope.$watch('versionFilters', function (newVal, oldVal) {
                if (newVal !== oldVal) {
                    updateVersionURLParameter(newVal);
                }
            }, true);

            $scope.$watch('applicabilities', function (newVal, oldVal) {
                if (newVal !== oldVal) {
                    updateURLParameter(newVal, 'applicabilities', APPLICABILITIES_FILTER_DEFAULT)
                }
            }, true);

            // Watch for changes in the URL path and update the search and lint display
            $scope.$watch(function () { return $location.path(); }, function (newPath) {
                const searchParameter = newPath.substring(1);
                if ($scope.search !== searchParameter) {
                    $scope.search = searchParameter;
                    $scope.open[searchParameter] = true;
                    scrollToLintByURL($scope, $location);
                }
            });

            let debounceTimeout;
            $scope.$watch('search', function (newVal, oldVal) {
                if (newVal !== oldVal) {
                    if (debounceTimeout) {
                        $timeout.cancel(debounceTimeout);
                    }

                    debounceTimeout = $timeout(function () {
                        $location.path(newVal);
                    }, 1000);
                }
            });

            $scope.$watch(function () { return $location.search(); }, function (newParameters) {
                loadFromURLParameters();
            }, true);

            $scope.updatePath = function () {
                if (debounceTimeout) {
                    $timeout.cancel(debounceTimeout);
                }

                $location.path($scope.search);
            }

            $scope.toggleLevels = function (value) {
                const levels = $scope.levels;
                for (const key in levels) {
                    if (levels.hasOwnProperty(key)) {
                        levels[key] = value;
                    }
                }
            };

            $scope.toggleGroups = function (value) {
                const groups = $scope.groups;
                for (const key in groups) {
                    if (groups.hasOwnProperty(key)) {
                        groups[key] = value;
                    }
                }
            };

            $scope.toggleApplicabilities = function (value) {
                const applicabilities = $scope.applicabilities;
                for (const key in applicabilities) {
                    if (applicabilities.hasOwnProperty(key)) {
                        applicabilities[key] = value;
                    }
                }
            }

            $scope.resetGroupsToDefault = function () {
                $scope.groups = {
                    ...GROUPS_FILTER_DEFAULT
                };
            };

            $scope.selectedValuesCount = function (obj) {
                return Object.values(obj).filter(x => x).length;
            }

            $scope.clearVersionFilters = function () {
                for (const filter in $scope.versionFilters) {
                    $scope.versionFilters[filter] = { enabled: false, minorVersion: null };
                }
            }

            $scope.versionFilterCount = function(obj) {
                return Object.values(obj).filter(x => x.enabled).length;
            }

            $scope.updateVersionFilters = function() {
                for (const filter in $scope.versionFilters) {
                    const minorVersion = $scope.versionFilters[filter].minorVersion;

                    // 1.29.0 and greater
                    if (minorVersion && minorVersion > 28) {
                        $scope.versionFilters[filter].enabled = true;
                        continue;
                    }

                    $scope.versionFilters[filter].enabled = false;
                }
            }

            $scope.byVersion = function(lint) {
                const filters = $scope.versionFilters;
                for (const filter in filters) {
                    if (filters[filter].enabled) {
                        const minorVersion = filters[filter].minorVersion;

                        // Strip the "pre " prefix for pre 1.29.0 lints
                        const lintVersion = lint.version.startsWith("pre ") ? lint.version.substring(4, lint.version.length) : lint.version;
                        const lintMinorVersion = lintVersion.substring(2, 4);

                        switch (filter) {
                            // "=" gets the highest priority, since all filters are inclusive
                            case "=":
                                return (lintMinorVersion == minorVersion);
                            case "≥":
                                if (lintMinorVersion < minorVersion) { return false; }
                                break;
                            case "≤":
                                if (lintMinorVersion > minorVersion) { return false; }
                                break;
                            default:
                                return true
                        }
                    }
                }

                return true;
            }

            $scope.byGroups = function (lint) {
                return $scope.groups[lint.group];
            };

            $scope.bySearch = function (lint, index, array) {
                let searchStr = $scope.search;
                // It can be `null` I haven't missed this value
                if (searchStr == null) {
                    return true;
                }
                searchStr = searchStr.toLowerCase();
                if (searchStr.startsWith("clippy::")) {
                    searchStr = searchStr.slice(8);
                }

                // Search by id
                if (lint.id.indexOf(searchStr.replaceAll("-", "_")) !== -1) {
                    return true;
                }

                // Search the description
                // The use of `for`-loops instead of `foreach` enables us to return early
                const terms = searchStr.split(" ");
                const docsLowerCase = lint.docs.toLowerCase();
                for (index = 0; index < terms.length; index++) {
                    // This is more likely and will therefore be checked first
                    if (docsLowerCase.indexOf(terms[index]) !== -1) {
                        continue;
                    }

                    if (lint.id.indexOf(terms[index]) !== -1) {
                        continue;
                    }

                    return false;
                }

                return true;
            }

            $scope.byApplicabilities = function (lint) {
                return $scope.applicabilities[lint.applicability.applicability];
            };

            // Show details for one lint
            $scope.openLint = function (lint) {
                $scope.open[lint.id] = true;
                $location.path(lint.id);
            };

            $scope.toggleExpansion = function(lints, isExpanded) {
                lints.forEach(lint => {
                    $scope.open[lint.id] = isExpanded;
                });
            }

            $scope.copyToClipboard = function (lint) {
                const clipboard = document.getElementById("clipboard-" + lint.id);
                if (clipboard) {
                    let resetClipboardTimeout = null;
                    const resetClipboardIcon = clipboard.innerHTML;

                    function resetClipboard() {
                        resetClipboardTimeout = null;
                        clipboard.innerHTML = resetClipboardIcon;
                    }

                    navigator.clipboard.writeText("clippy::" + lint.id);

                    clipboard.innerHTML = "&#10003;";
                    if (resetClipboardTimeout !== null) {
                        clearTimeout(resetClipboardTimeout);
                    }
                    resetClipboardTimeout = setTimeout(resetClipboard, 1000);
                }
            }

            // Get data
            $scope.open = {};
            $scope.loading = true;

            // This will be used to jump into the source code of the version that this documentation is for.
            $scope.docVersion = window.location.pathname.split('/')[2] || "master";

            // Set up the filters from the URL parameters before we start loading the data
            loadFromURLParameters();

            $http.get('./lints.json')
                .success(function (data) {
                    $scope.data = data;
                    $scope.loading = false;

                    const selectedGroup = getQueryVariable("sel");
                    if (selectedGroup) {
                        selectGroup($scope, selectedGroup.toLowerCase());
                    }

                    scrollToLintByURL($scope, $location);

                    setTimeout(function () {
                        const el = document.getElementById('filter-input');
                        if (el) { el.focus() }
                    }, 0);
                })
                .error(function (data) {
                    $scope.error = data;
                    $scope.loading = false;
                });
        });
})();

function getQueryVariable(variable) {
    const query = window.location.search.substring(1);
    const vars = query.split('&');
    for (const entry of vars) {
        const pair = entry.split('=');
        if (decodeURIComponent(pair[0]) == variable) {
            return decodeURIComponent(pair[1]);
        }
    }
}

function storeValue(settingName, value) {
    try {
        localStorage.setItem(`clippy-lint-list-${settingName}`, value);
    } catch (e) { }
}

function loadValue(settingName) {
    return localStorage.getItem(`clippy-lint-list-${settingName}`);
}

function setTheme(theme, store) {
    let enableHighlight = false;
    let enableNight = false;
    let enableAyu = false;

    switch(theme) {
        case "ayu":
            enableAyu = true;
            break;
        case "coal":
        case "navy":
            enableNight = true;
            break;
        case "rust":
            enableHighlight = true;
            break;
        default:
            enableHighlight = true;
            theme = "light";
            break;
    }

    document.getElementsByTagName("body")[0].className = theme;

    document.getElementById("githubLightHighlight").disabled = enableNight || !enableHighlight;
    document.getElementById("githubDarkHighlight").disabled = !enableNight && !enableAyu;

    document.getElementById("styleHighlight").disabled = !enableHighlight;
    document.getElementById("styleNight").disabled = !enableNight;
    document.getElementById("styleAyu").disabled = !enableAyu;

    if (store) {
        storeValue("theme", theme);
    } else {
        document.getElementById(`theme-choice`).value = theme;
    }
}

function handleShortcut(ev) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || disableShortcuts) {
        return;
    }

    if (document.activeElement.tagName === "INPUT") {
        if (ev.key === "Escape") {
            document.activeElement.blur();
        }
    } else {
        switch (ev.key) {
            case "s":
            case "S":
            case "/":
                ev.preventDefault(); // To prevent the key to be put into the input.
                document.getElementById("search-input").focus();
                break;
            default:
                break;
        }
    }
}

document.addEventListener("keypress", handleShortcut);
document.addEventListener("keydown", handleShortcut);

function changeSetting(elem) {
    if (elem.id === "disable-shortcuts") {
        disableShortcuts = elem.checked;
        storeValue(elem.id, elem.checked);
    }
}

function onEachLazy(lazyArray, func) {
    const arr = Array.prototype.slice.call(lazyArray);
    for (const el of arr) {
        func(el);
    }
}

function handleBlur(event) {
    const parent = document.getElementById("settings-dropdown");
    if (!parent.contains(document.activeElement) &&
        !parent.contains(event.relatedTarget)
    ) {
        parent.classList.remove("open");
    }
}

function generateSettings() {
    const settings = document.getElementById("settings-dropdown");
    const settingsButton = settings.querySelector(".settings-icon")
    settingsButton.onclick = () => settings.classList.toggle("open");
    settingsButton.onblur = handleBlur;
    const settingsMenu = settings.querySelector(".settings-menu");
    settingsMenu.onblur = handleBlur;
    onEachLazy(
        settingsMenu.querySelectorAll("input"),
        el => el.onblur = handleBlur,
    );
}

generateSettings();

// loading the theme after the initial load
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
const theme = loadValue('theme');
if (prefersDark.matches && !theme) {
    setTheme("coal", false);
} else {
    setTheme(theme, false);
}
let disableShortcuts = loadValue('disable-shortcuts') === "true";
document.getElementById("disable-shortcuts").checked = disableShortcuts;
