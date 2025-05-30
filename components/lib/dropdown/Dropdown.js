import * as React from 'react';
import PrimeReact, { FilterService, PrimeReactContext, localeOption } from '../api/Api';
import { useHandleStyle } from '../componentbase/ComponentBase';
import { useDebounce, useMergeProps, useMountEffect, useOverlayListener, useUnmountEffect, useUpdateEffect } from '../hooks/Hooks';
import { ChevronDownIcon } from '../icons/chevrondown';
import { ChevronUpIcon } from '../icons/chevronup';
import { SpinnerIcon } from '../icons/spinner';
import { TimesIcon } from '../icons/times';
import { OverlayService } from '../overlayservice/OverlayService';
import { Tooltip } from '../tooltip/Tooltip';
import { DomHandler, IconUtils, ObjectUtils, ZIndexUtils, classNames } from '../utils/Utils';
import { DropdownBase } from './DropdownBase';
import { DropdownPanel } from './DropdownPanel';

export const Dropdown = React.memo(
    React.forwardRef((inProps, ref) => {
        const mergeProps = useMergeProps();
        const context = React.useContext(PrimeReactContext);
        const props = DropdownBase.getProps(inProps, context);
        const [filterValue, filterState, setFilterState] = useDebounce('', props.filterDelay || 0);
        const [focusedState, setFocusedState] = React.useState(false);
        const [focusedOptionIndex, setFocusedOptionIndex] = React.useState(-1);
        const [overlayVisibleState, setOverlayVisibleState] = React.useState(false);
        const clickedRef = React.useRef(false);
        const elementRef = React.useRef(null);
        const overlayRef = React.useRef(null);
        const firstHiddenFocusableElementOnOverlay = React.useRef(null);
        const lastHiddenFocusableElementOnOverlay = React.useRef(null);
        const inputRef = React.useRef(props.inputRef);
        const focusInputRef = React.useRef(props.focusInputRef);
        const virtualScrollerRef = React.useRef(null);
        const searchTimeout = React.useRef(null);
        const searchValue = React.useRef(null);
        const isLazy = props.virtualScrollerOptions && props.virtualScrollerOptions.lazy;
        const hasFilter = ObjectUtils.isNotEmpty(filterState);
        const appendTo = props.appendTo || (context && context.appendTo) || PrimeReact.appendTo;
        const { ptm, cx, sx, isUnstyled } = DropdownBase.setMetaData({
            props,
            ...props.__parentMetadata,
            state: {
                filter: filterState,
                focused: focusedState,
                overlayVisible: overlayVisibleState
            }
        });

        useHandleStyle(DropdownBase.css.styles, isUnstyled, { name: 'dropdown' });

        const [bindOverlayListener, unbindOverlayListener] = useOverlayListener({
            target: elementRef,
            overlay: overlayRef,
            listener: (event, { type, valid }) => {
                if (valid) {
                    if (type === 'outside') {
                        if (!isClearClicked(event)) {
                            hide();
                        }
                    } else if (context.hideOverlaysOnDocumentScrolling) {
                        hide();
                    } else if (!DomHandler.isDocument(event.target)) {
                        alignOverlay();
                    }
                }
            },
            when: overlayVisibleState
        });

        const flatOptions = (options) => {
            return (options || []).reduce((result, option, index) => {
                result.push({ ...option, group: true, index });

                const optionGroupChildren = getOptionGroupChildren(option);

                optionGroupChildren && optionGroupChildren.forEach((o) => result.push(o));

                return result;
            }, []);
        };

        const getVisibleOptions = () => {
            const options = props.optionGroupLabel ? flatOptions(props.options) : props.options;

            if (hasFilter && !isLazy) {
                const filterValue = filterState.trim().toLocaleLowerCase(props.filterLocale);
                const searchFields = props.filterBy ? props.filterBy.split(',') : [props.optionLabel || 'label'];

                if (props.optionGroupLabel) {
                    let filteredGroups = [];

                    for (let optgroup of props.options) {
                        let filteredSubOptions = FilterService.filter(getOptionGroupChildren(optgroup), searchFields, filterValue, props.filterMatchMode, props.filterLocale);

                        if (filteredSubOptions && filteredSubOptions.length) {
                            filteredGroups.push({ ...optgroup, ...{ [`${props.optionGroupChildren}`]: filteredSubOptions } });
                        }
                    }

                    return flatOptions(filteredGroups);
                }

                return FilterService.filter(options, searchFields, filterValue, props.filterMatchMode, props.filterLocale);
            }

            return options;
        };

        const onFirstHiddenFocus = (event) => {
            const focusableEl = event.relatedTarget === focusInputRef.current ? DomHandler.getFirstFocusableElement(overlayRef.current, ':not([data-p-hidden-focusable="true"])') : focusInputRef.current;

            DomHandler.focus(focusableEl);
        };

        const onLastHiddenFocus = (event) => {
            const focusableEl = event.relatedTarget === focusInputRef.current ? DomHandler.getLastFocusableElement(overlayRef.current, ':not([data-p-hidden-focusable="true"])') : focusInputRef.current;

            DomHandler.focus(focusableEl);
        };

        const isClearClicked = (event) => {
            return DomHandler.isAttributeEquals(event.target, 'data-pc-section', 'clearicon') || DomHandler.isAttributeEquals(event.target.parentElement || event.target, 'data-pc-section', 'filterclearicon');
        };

        const onClick = (event) => {
            if (props.disabled || props.loading) {
                return;
            }

            props.onClick && props.onClick(event);

            // do not continue if the user defined click wants to prevent it
            if (event.defaultPrevented) {
                return;
            }

            if (isClearClicked(event) || event.target.tagName === 'INPUT') {
                return;
            } else if (!overlayRef.current || !(overlayRef.current && overlayRef.current.contains(event.target))) {
                DomHandler.focus(focusInputRef.current);
                overlayVisibleState ? hide() : show();
            }

            event.preventDefault();
            clickedRef.current = true;
        };

        const onInputFocus = (event) => {
            if (props.showOnFocus && !overlayVisibleState) {
                show();
            }

            setFocusedState(true);
            props.onFocus && props.onFocus(event);
        };

        const onInputBlur = (event) => {
            setFocusedState(false);

            if (props.onBlur) {
                setTimeout(() => {
                    const currentValue = inputRef.current ? inputRef.current.value : undefined;

                    props.onBlur({
                        originalEvent: event.originalEvent,
                        value: currentValue,
                        stopPropagation: () => {
                            event.originalEvent.stopPropagation();
                        },
                        preventDefault: () => {
                            event.originalEvent.preventDefault();
                        },
                        target: {
                            name: props.name,
                            id: props.id,
                            value: currentValue
                        }
                    });
                }, 200);
            }
        };

        const onOptionSelect = (event, option, isHide = true) => {
            selectItem({
                originalEvent: event,
                option
            });

            if (isHide) {
                hide(true);

                DomHandler.focus(focusInputRef.current);
            }
        };

        const onPanelClick = (event) => {
            OverlayService.emit('overlay-click', {
                originalEvent: event,
                target: elementRef.current
            });
        };

        const onInputKeyDown = (event) => {
            if (props.disabled) {
                event.preventDefault();

                return;
            }

            const code = DomHandler.isAndroid() ? event.key : event.code;

            switch (code) {
                case 'ArrowDown':
                    onArrowDownKey(event);
                    break;

                case 'ArrowUp':
                    onArrowUpKey(event);
                    break;

                case 'ArrowLeft':
                case 'ArrowRight':
                    onArrowLeftKey(event, props.editable);
                    break;

                case 'Home':
                    onHomeKey(event);
                    break;

                case 'End':
                    onEndKey(event);
                    break;

                case 'PageDown':
                    onPageDownKey(event);
                    break;

                case 'PageUp':
                    onPageUpKey(event);
                    break;

                case 'Space':
                    onSpaceKey(event, props.editable);
                    break;

                case 'NumpadEnter':
                case 'Enter':
                    onEnterKey(event);
                    break;

                case 'Escape':
                    onEscapeKey(event);
                    break;

                case 'Tab':
                    onTabKey(event);
                    break;

                case 'Backspace':
                    onBackspaceKey(event, props.editable);
                    break;

                case 'ShiftLeft':
                case 'ShiftRight':
                    //NOOP
                    break;

                default:
                    const metaKey = event.metaKey || event.ctrlKey || event.altKey;

                    // Only handle printable characters when no meta keys are pressed
                    if (!metaKey && ObjectUtils.isPrintableCharacter(event.key)) {
                        !overlayVisibleState && !props.editable && show();
                        !props.editable && searchOptions(event, event.key);
                    }

                    break;
            }

            clickedRef.current = false;
        };

        const onFilterInputKeyDown = (event) => {
            switch (event.code) {
                case 'ArrowDown':
                    onArrowDownKey(event);
                    break;

                case 'ArrowUp':
                    onArrowUpKey(event);
                    break;

                case 'ArrowLeft':
                case 'ArrowRight':
                    onArrowLeftKey(event, true);
                    break;

                case 'Enter':
                case 'NumpadEnter':
                    onEnterKey(event);
                    event.preventDefault();
                    break;

                case 'Escape':
                    onEscapeKey(event);
                    break;
                default:
                    break;
            }
        };

        const hasFocusableElements = () => {
            return DomHandler.getFocusableElements(overlayRef.current, ':not([data-p-hidden-focusable="true"])').length > 0;
        };

        const isOptionMatched = (option) => {
            return isValidOption(option) && getOptionLabel(option)?.toLocaleLowerCase(props.filterLocale).startsWith(searchValue.current.toLocaleLowerCase(props.filterLocale));
        };

        const isValidOption = (option) => {
            return ObjectUtils.isNotEmpty(option) && !(isOptionDisabled(option) || isOptionGroup(option));
        };

        const hasSelectedOption = () => {
            return ObjectUtils.isNotEmpty(props.value);
        };

        const isValidSelectedOption = (option) => {
            return isValidOption(option) && isSelected(option);
        };

        const findSelectedOptionIndex = () => {
            return hasSelectedOption ? visibleOptions.findIndex((option) => isValidSelectedOption(option)) : -1;
        };

        const findFirstFocusedOptionIndex = () => {
            const selectedIndex = findSelectedOptionIndex();

            return selectedIndex < 0 ? findFirstOptionIndex() : selectedIndex;
        };

        const searchOptions = (event, char) => {
            searchValue.current = (searchValue.current || '') + char;

            let optionIndex = -1;
            let matched = false;

            if (ObjectUtils.isNotEmpty(searchValue.current)) {
                if (focusedOptionIndex !== -1) {
                    optionIndex = visibleOptions.slice(focusedOptionIndex).findIndex((option) => isOptionMatched(option));
                    optionIndex = optionIndex === -1 ? visibleOptions.slice(0, focusedOptionIndex).findIndex((option) => isOptionMatched(option)) : optionIndex + focusedOptionIndex;
                } else {
                    optionIndex = visibleOptions.findIndex((option) => isOptionMatched(option));
                }

                if (optionIndex !== -1) {
                    matched = true;
                }

                if (optionIndex === -1 && focusedOptionIndex === -1) {
                    optionIndex = findFirstFocusedOptionIndex();
                }

                if (optionIndex !== -1) {
                    changeFocusedOptionIndex(event, optionIndex);
                }
            }

            if (searchTimeout.current) {
                clearTimeout(searchTimeout.current);
            }

            searchTimeout.current = setTimeout(() => {
                searchValue.current = '';
                searchTimeout.current = null;
            }, 500);

            return matched;
        };

        const findLastFocusedOptionIndex = () => {
            const selectedIndex = findSelectedOptionIndex();

            return selectedIndex < 0 ? findLastOptionIndex() : selectedIndex;
        };

        const findFirstOptionIndex = () => {
            return visibleOptions.findIndex((option) => isValidOption(option));
        };

        const findLastOptionIndex = () => {
            return ObjectUtils.findLastIndex(visibleOptions, (option) => isValidOption(option));
        };

        const findNextOptionIndex = (index) => {
            const matchedOptionIndex = index < visibleOptions.length - 1 ? visibleOptions.slice(index + 1).findIndex((option) => isValidOption(option)) : -1;

            return matchedOptionIndex > -1 ? matchedOptionIndex + index + 1 : index;
        };

        const findPrevOptionIndex = (index) => {
            const matchedOptionIndex = index > 0 ? ObjectUtils.findLastIndex(visibleOptions.slice(0, index), (option) => isValidOption(option)) : -1;

            return matchedOptionIndex > -1 ? matchedOptionIndex : index;
        };

        const changeFocusedOptionIndex = (event, index) => {
            if (focusedOptionIndex !== index) {
                setFocusedOptionIndex(index);
                focusOnItem(index);

                if (props.selectOnFocus) {
                    onOptionSelect(event, visibleOptions[index], false);
                }
            }
        };

        const focusOnItem = (index) => {
            const focusedItem = DomHandler.findSingle(overlayRef.current, `li[id="dropdownItem_${index}"]`);

            focusedItem && focusedItem.focus();
        };

        const onArrowDownKey = (event) => {
            if (!overlayVisibleState) {
                show();
                props.editable && changeFocusedOptionIndex(event, findSelectedOptionIndex());
            } else {
                const optionIndex = focusedOptionIndex !== -1 ? findNextOptionIndex(focusedOptionIndex) : clickedRef.current ? findFirstOptionIndex() : findFirstFocusedOptionIndex();

                changeFocusedOptionIndex(event, optionIndex);
            }

            event.preventDefault();
        };

        const onArrowUpKey = (event, pressedInInputText = false) => {
            if (event.altKey && !pressedInInputText) {
                if (focusedOptionIndex !== -1) {
                    onOptionSelect(event, visibleOptions[focusedOptionIndex]);
                }

                state.overlayVisible && hide();
                event.preventDefault();
            } else {
                const optionIndex = focusedOptionIndex !== -1 ? findPrevOptionIndex(focusedOptionIndex) : clickedRef.current ? findLastOptionIndex() : findLastFocusedOptionIndex();

                changeFocusedOptionIndex(event, optionIndex);

                !overlayVisibleState && show();
                event.preventDefault();
            }
        };

        const onArrowLeftKey = (event, pressedInInputText = false) => {
            pressedInInputText && setFocusedOptionIndex(-1);
        };

        const onHomeKey = (event, pressedInInputText = false) => {
            if (pressedInInputText) {
                event.currentTarget.setSelectionRange(0, 0);
                setFocusedOptionIndex(-1);
            } else {
                changeFocusedOptionIndex(event, findFirstOptionIndex());

                !overlayVisibleState && show();
            }

            event.preventDefault();
        };

        const onEndKey = (event, pressedInInputText = false) => {
            if (pressedInInputText) {
                const target = event.currentTarget;
                const len = target.value.length;

                target.setSelectionRange(len, len);
                setFocusedOptionIndex(-1);
            } else {
                changeFocusedOptionIndex(event, findLastOptionIndex());

                !overlayVisibleState && show();
            }

            event.preventDefault();
        };

        const onPageUpKey = (event) => {
            event.preventDefault();
        };

        const onPageDownKey = (event) => {
            event.preventDefault();
        };

        const onSpaceKey = (event, pressedInInputText = false) => {
            !pressedInInputText && onEnterKey(event);
        };

        const onEnterKey = (event) => {
            event.preventDefault();

            if (!overlayVisibleState) {
                setFocusedOptionIndex(-1);
                onArrowDownKey(event);
            } else {
                if (focusedOptionIndex === -1) {
                    return;
                }

                const focusedOption = visibleOptions[focusedOptionIndex];
                const optionValue = getOptionValue(focusedOption);

                if (optionValue == null || optionValue == undefined) {
                    hide();
                    resetFilter();
                    updateEditableLabel(selectedOption);

                    return;
                }

                onOptionSelect(event, focusedOption);
            }
        };

        const onEscapeKey = (event) => {
            overlayVisibleState && hide();
            event.preventDefault();
        };

        const onTabKey = (event, pressedInInputText = false) => {
            if (!pressedInInputText) {
                if (overlayVisibleState && !hasFocusableElements()) {
                    DomHandler.focus(firstHiddenFocusableElementOnOverlay.current);

                    event.preventDefault();
                } else {
                    if (focusedOptionIndex !== -1) {
                        onOptionSelect(event, visibleOptions[focusedOptionIndex]);
                    }

                    overlayVisibleState && hide();
                }
            }
        };

        const onBackspaceKey = (event, pressedInInputText = false) => {
            if (event && pressedInInputText) {
                !overlayVisibleState && show();
            }
        };

        const findNextOption = (index) => {
            if (props.optionGroupLabel) {
                const groupIndex = index === -1 ? 0 : index.group;
                const optionIndex = index === -1 ? -1 : index.option;
                const option = findNextOptionInList(getOptionGroupChildren(visibleOptions[groupIndex]), optionIndex);

                if (option) {
                    return option;
                } else if (groupIndex + 1 !== visibleOptions.length) {
                    return findNextOption({ group: groupIndex + 1, option: -1 });
                }

                return null;
            }

            return findNextOptionInList(visibleOptions, index);
        };

        const findNextOptionInList = (list, index) => {
            const i = index + 1;

            if (i === list.length) {
                return null;
            }

            const option = list[i];

            return isOptionDisabled(option) ? findNextOptionInList(i) : option;
        };

        const findPrevOption = (index) => {
            if (index === -1) {
                return null;
            }

            if (props.optionGroupLabel) {
                const groupIndex = index.group;
                const optionIndex = index.option;
                const option = findPrevOptionInList(getOptionGroupChildren(visibleOptions[groupIndex]), optionIndex);

                if (option) {
                    return option;
                } else if (groupIndex > 0) {
                    return findPrevOption({
                        group: groupIndex - 1,
                        option: getOptionGroupChildren(visibleOptions[groupIndex - 1]).length
                    });
                }

                return null;
            }

            return findPrevOptionInList(visibleOptions, index);
        };

        const findPrevOptionInList = (list, index) => {
            const i = index - 1;

            if (i < 0) {
                return null;
            }

            const option = list[i];

            return isOptionDisabled(option) ? findPrevOption(i) : option;
        };

        const findInArray = (visibleOptions, searchText) => {
            if (!searchText || !visibleOptions?.length) return -1;

            const normalizedSearch = searchText.toLocaleLowerCase();

            const exactMatch = visibleOptions.findIndex((item) => getOptionLabel(item).toLocaleLowerCase() === normalizedSearch);

            if (exactMatch !== -1) return exactMatch;

            return visibleOptions.findIndex((item) => getOptionLabel(item).toLocaleLowerCase().startsWith(normalizedSearch));
        };

        const onEditableInputChange = (event) => {
            !overlayVisibleState && show();
            let searchIndex = null;

            if (event.target.value && visibleOptions) {
                searchIndex = findInArray(visibleOptions, event.target.value);
            }

            setFocusedOptionIndex(searchIndex);

            if (props.onChange) {
                props.onChange({
                    originalEvent: event.originalEvent,
                    value: event.target.value,
                    stopPropagation: () => {
                        event.originalEvent.stopPropagation();
                    },
                    preventDefault: () => {
                        event.originalEvent.preventDefault();
                    },
                    target: {
                        name: props.name,
                        id: props.id,
                        value: event.target.value
                    }
                });
            }
        };

        const onEditableInputFocus = (event) => {
            setFocusedState(true);
            hide();
            props.onFocus && props.onFocus(event);
        };

        const onOptionClick = (event) => {
            const option = event.option;

            if (!option.disabled) {
                selectItem(event);
                DomHandler.focus(focusInputRef.current);
            }

            hide();
        };

        const onFilterInputChange = (event) => {
            const filter = event.target.value;

            setFilterState(filter);

            if (props.onFilter) {
                props.onFilter({
                    originalEvent: event,
                    filter
                });
            }
        };

        const onFilterClearIconClick = (callback) => {
            resetFilter(callback);
        };

        const resetFilter = (callback) => {
            setFilterState('');
            props.onFilter && props.onFilter({ filter: '' });
            callback && callback();
        };

        const clear = (event) => {
            if (props.onChange) {
                props.onChange({
                    originalEvent: event,
                    value: undefined,
                    stopPropagation: () => {
                        event?.stopPropagation();
                    },
                    preventDefault: () => {
                        event?.preventDefault();
                    },
                    target: {
                        name: props.name,
                        id: props.id,
                        value: undefined
                    }
                });
            }

            if (props.filter) {
                resetFilter();
            }

            updateEditableLabel();
            setFocusedOptionIndex(-1);
        };

        const selectItem = (event) => {
            if (selectedOption !== event.option) {
                updateEditableLabel(event.option);
                setFocusedOptionIndex(-1);
                const optionValue = getOptionValue(event.option);

                const selectedOptionIndex = findOptionIndexInList(event.option, visibleOptions);

                if (props.onChange) {
                    props.onChange({
                        originalEvent: event.originalEvent,
                        value: optionValue,
                        stopPropagation: () => {
                            event.originalEvent.stopPropagation();
                        },
                        preventDefault: () => {
                            event.originalEvent.preventDefault();
                        },
                        target: {
                            name: props.name,
                            id: props.id,
                            value: optionValue
                        }
                    });
                }

                changeFocusedOptionIndex(event.originalEvent, selectedOptionIndex);
            }
        };

        const getSelectedOptionIndex = (options) => {
            options = options || visibleOptions;

            if (options) {
                if (props.optionGroupLabel) {
                    for (let i = 0; i < options.length; i++) {
                        let selectedOptionIndex = findOptionIndexInList(props.value, getOptionGroupChildren(options[i]));

                        if (selectedOptionIndex !== -1) {
                            return { group: i, option: selectedOptionIndex };
                        }
                    }
                } else {
                    return findOptionIndexInList(props.value, options);
                }
            }

            return -1;
        };

        const equalityKey = () => {
            return props.optionValue ? null : props.dataKey;
        };

        const findOptionIndexInList = (value, list) => {
            const key = equalityKey();

            return list.findIndex((item) => ObjectUtils.equals(value, getOptionValue(item), key));
        };

        const isSelected = (option) => {
            return ObjectUtils.equals(props.value, getOptionValue(option), equalityKey());
        };

        const show = () => {
            setFocusedOptionIndex(focusedOptionIndex !== -1 ? focusedOptionIndex : props.autoOptionFocus ? findFirstFocusedOptionIndex() : props.editable ? -1 : findSelectedOptionIndex());
            setOverlayVisibleState(true);
        };

        const hide = () => {
            setOverlayVisibleState(false);
            clickedRef.current = false;
        };

        const onFocus = () => {
            if (props.editable && !overlayVisibleState && clickedRef.current === false) {
                DomHandler.focus(inputRef.current);
            }
        };

        const onOverlayEnter = (callback) => {
            ZIndexUtils.set('overlay', overlayRef.current, (context && context.autoZIndex) || PrimeReact.autoZIndex, (context && context.zIndex.overlay) || PrimeReact.zIndex.overlay);
            DomHandler.addStyles(overlayRef.current, { position: 'absolute', top: '0', left: '0' });
            alignOverlay();
            callback && callback();
        };

        const onOverlayEntered = (callback) => {
            callback && callback();
            bindOverlayListener();

            props.onShow && props.onShow();
        };

        const onOverlayExit = () => {
            unbindOverlayListener();
        };

        const onOverlayExited = () => {
            if (props.filter && props.resetFilterOnHide) {
                resetFilter();
            }

            ZIndexUtils.clear(overlayRef.current);

            props.onHide && props.onHide();
        };

        const alignOverlay = () => {
            DomHandler.alignOverlay(overlayRef.current, inputRef.current.parentElement, props.appendTo || (context && context.appendTo) || PrimeReact.appendTo);
        };

        const scrollInView = () => {
            const focusedItem = DomHandler.findSingle(overlayRef.current, 'li[data-p-focused="true"]');

            if (focusedItem && focusedItem.scrollIntoView) {
                focusedItem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } else {
                const highlightItem = DomHandler.findSingle(overlayRef.current, 'li[data-p-highlight="true"]');

                if (highlightItem && highlightItem.scrollIntoView) {
                    highlightItem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            }
        };

        const updateEditableLabel = (option) => {
            if (inputRef.current) {
                inputRef.current.value = option ? getOptionLabel(option) : props.value || '';

                // #1413 NVDA screenreader
                if (focusInputRef.current) {
                    focusInputRef.current.value = inputRef.current.value;
                }
            }
        };

        const getOptionLabel = (option) => {
            if (ObjectUtils.isScalar(option)) {
                return `${option}`;
            }

            const optionLabel = props.optionLabel ? ObjectUtils.resolveFieldData(option, props.optionLabel) : option['label'];

            return `${optionLabel}`;
        };

        const getOptionValue = (option) => {
            if (props.useOptionAsValue) {
                return option;
            }

            const optionValue = props.optionValue ? ObjectUtils.resolveFieldData(option, props.optionValue) : option ? option['value'] : ObjectUtils.resolveFieldData(option, 'value');

            return props.optionValue || ObjectUtils.isNotEmpty(optionValue) ? optionValue : option;
        };

        const getOptionRenderKey = (option) => {
            return props.dataKey ? ObjectUtils.resolveFieldData(option, props.dataKey) : getOptionLabel(option);
        };

        const isOptionGroup = (option) => {
            return props.optionGroupLabel && option.group;
        };

        const isOptionDisabled = (option) => {
            if (props.optionDisabled) {
                return ObjectUtils.isFunction(props.optionDisabled) ? props.optionDisabled(option) : ObjectUtils.resolveFieldData(option, props.optionDisabled);
            }

            return option && option.disabled !== undefined ? option.disabled : false;
        };

        const getOptionGroupRenderKey = (optionGroup) => {
            return ObjectUtils.resolveFieldData(optionGroup, props.optionGroupLabel);
        };

        const getOptionGroupLabel = (optionGroup) => {
            return ObjectUtils.resolveFieldData(optionGroup, props.optionGroupLabel);
        };

        const getOptionGroupChildren = (optionGroup) => {
            return ObjectUtils.resolveFieldData(optionGroup, props.optionGroupChildren);
        };

        const updateInputField = () => {
            if (props.editable && inputRef.current) {
                const label = selectedOption ? getOptionLabel(selectedOption) : null;
                const value = label || props.value || '';

                inputRef.current.value = value;

                // #1413 NVDA screenreader
                if (focusInputRef.current) {
                    focusInputRef.current.value = value;
                }
            }
        };

        const getSelectedOption = () => {
            const index = getSelectedOptionIndex(props.options);

            return index !== -1 ? (props.optionGroupLabel ? getOptionGroupChildren(props.options[index.group])[index.option] : props.options[index]) : null;
        };

        React.useImperativeHandle(ref, () => ({
            props,
            show,
            hide,
            clear,
            focus: () => DomHandler.focus(focusInputRef.current),
            getElement: () => elementRef.current,
            getOverlay: () => overlayRef.current,
            getInput: () => inputRef.current,
            getFocusInput: () => focusInputRef.current,
            getVirtualScroller: () => virtualScrollerRef.current
        }));

        React.useEffect(() => {
            ObjectUtils.combinedRefs(inputRef, props.inputRef);
            ObjectUtils.combinedRefs(focusInputRef, props.focusInputRef);
        }, [inputRef, props.inputRef, focusInputRef, props.focusInputRef]);

        useMountEffect(() => {
            if (props.autoFocus) {
                DomHandler.focus(focusInputRef.current, props.autoFocus);
            }

            alignOverlay();
        });

        useUpdateEffect(() => {
            if (overlayVisibleState && (props.value || focusedOptionIndex >= 0)) {
                scrollInView();
            }
        }, [overlayVisibleState, props.value, focusedOptionIndex]);

        useUpdateEffect(() => {
            if (overlayVisibleState && filterState && props.filter) {
                alignOverlay();
            }
        }, [overlayVisibleState, filterState, props.filter]);

        useUpdateEffect(() => {
            virtualScrollerRef.current && virtualScrollerRef.current.scrollInView(0);
        }, [filterState]);

        useUpdateEffect(() => {
            updateInputField();

            if (inputRef.current) {
                inputRef.current.selectedIndex = 1;
            }
        });

        useUnmountEffect(() => {
            ZIndexUtils.clear(overlayRef.current);
        });

        const createHiddenSelect = () => {
            let option = { value: '', label: props.placeholder };

            if (selectedOption) {
                const optionValue = getOptionValue(selectedOption);

                option = {
                    value: typeof optionValue === 'object' ? props.options.findIndex((o) => o === optionValue) : optionValue,
                    label: getOptionLabel(selectedOption)
                };
            }

            const hiddenSelectedMessageProps = mergeProps(
                {
                    className: 'p-hidden-accessible p-dropdown-hidden-select'
                },
                ptm('hiddenSelectedMessage')
            );

            const selectProps = mergeProps(
                {
                    ref: inputRef,
                    required: props.required,
                    defaultValue: option.value,
                    name: props.name,
                    tabIndex: -1
                },
                ptm('select')
            );

            const optionProps = mergeProps(
                {
                    value: option.value
                },
                ptm('option')
            );

            return (
                <div {...hiddenSelectedMessageProps}>
                    <select {...selectProps}>
                        <option {...optionProps}>{option.label}</option>
                    </select>
                </div>
            );
        };

        const createKeyboardHelper = () => {
            let value = ObjectUtils.isNotEmpty(selectedOption) ? getOptionLabel(selectedOption) : null;

            if (props.editable) {
                value = value || props.value || '';
            }

            const hiddenSelectedMessageProps = mergeProps(
                {
                    className: 'p-hidden-accessible'
                },
                ptm('hiddenSelectedMessage')
            );

            const inputProps = mergeProps(
                {
                    ref: focusInputRef,
                    id: props.inputId,
                    defaultValue: value,
                    type: 'text',
                    readOnly: true,
                    'aria-haspopup': 'listbox',
                    onFocus: onInputFocus,
                    onBlur: onInputBlur,
                    onKeyDown: onInputKeyDown,
                    disabled: props.disabled,
                    tabIndex: !props.disabled ? props.tabIndex || 0 : -1,
                    ...ariaProps
                },
                ptm('input')
            );

            return (
                <div {...hiddenSelectedMessageProps}>
                    <input {...inputProps} />
                </div>
            );
        };

        const createLabel = () => {
            const label = ObjectUtils.isNotEmpty(selectedOption) ? getOptionLabel(selectedOption) : null;

            if (props.editable) {
                const value = label || props.value || '';
                const inputProps = mergeProps(
                    {
                        ref: inputRef,
                        type: 'text',
                        defaultValue: value,
                        className: cx('input', { label }),
                        disabled: props.disabled,
                        placeholder: props.placeholder,
                        maxLength: props.maxLength,
                        onInput: onEditableInputChange,
                        onFocus: onEditableInputFocus,
                        onKeyDown: onInputKeyDown,
                        onBlur: onInputBlur,
                        tabIndex: !props.disabled ? props.tabIndex || 0 : -1,
                        'aria-haspopup': 'listbox',
                        ...ariaProps
                    },
                    ptm('input')
                );

                return <input {...inputProps} />;
            }

            const content = props.valueTemplate ? ObjectUtils.getJSXElement(props.valueTemplate, selectedOption, props) : label || props.placeholder || props.emptyMessage || <>&nbsp;</>;
            const inputProps = mergeProps(
                {
                    ref: inputRef,
                    className: cx('input', { label }),
                    tabIndex: '-1'
                },
                ptm('input')
            );

            return <span {...inputProps}>{content}</span>;
        };

        const onClearIconKeyDown = (event) => {
            if (event.key === 'Enter' || event.code === 'Space') {
                clear(event);
                event.preventDefault();
            }
        };

        const createClearIcon = () => {
            if (props.value != null && props.showClear && !props.disabled && !ObjectUtils.isEmpty(props.options)) {
                const clearIconProps = mergeProps(
                    {
                        className: cx('clearIcon'),
                        onPointerUp: clear,
                        tabIndex: props.editable ? -1 : props.tabIndex || '0',
                        onKeyDown: onClearIconKeyDown,
                        'aria-label': localeOption('clear')
                    },
                    ptm('clearIcon')
                );
                const icon = props.clearIcon || <TimesIcon {...clearIconProps} />;

                return IconUtils.getJSXIcon(icon, { ...clearIconProps }, { props });
            }

            return null;
        };

        const createLoadingIcon = () => {
            const loadingIconProps = mergeProps(
                {
                    className: cx('loadingIcon'),
                    'data-pr-overlay-visible': overlayVisibleState
                },
                ptm('loadingIcon')
            );
            const icon = props.loadingIcon || <SpinnerIcon spin />;
            const loadingIcon = IconUtils.getJSXIcon(icon, { ...loadingIconProps }, { props });
            const ariaLabel = props.placeholder || props.ariaLabel;
            const loadingButtonProps = mergeProps(
                {
                    className: cx('trigger'),
                    role: 'button',
                    'aria-haspopup': 'listbox',
                    'aria-expanded': overlayVisibleState,
                    'aria-label': ariaLabel
                },
                ptm('trigger')
            );

            return <div {...loadingButtonProps}>{loadingIcon}</div>;
        };

        const createDropdownIcon = () => {
            const dropdownIconProps = mergeProps(
                {
                    className: cx('dropdownIcon'),
                    'data-pr-overlay-visible': overlayVisibleState
                },
                ptm('dropdownIcon')
            );
            const icon = !overlayVisibleState ? props.dropdownIcon || <ChevronDownIcon {...dropdownIconProps} /> : props.collapseIcon || <ChevronUpIcon {...dropdownIconProps} />;
            const dropdownIcon = IconUtils.getJSXIcon(icon, { ...dropdownIconProps }, { props });

            const ariaLabel = props.placeholder || props.ariaLabel;
            const triggerProps = mergeProps(
                {
                    className: cx('trigger'),
                    role: 'button',
                    'aria-haspopup': 'listbox',
                    'aria-expanded': overlayVisibleState,
                    'aria-label': ariaLabel
                },
                ptm('trigger')
            );

            return <div {...triggerProps}>{dropdownIcon}</div>;
        };

        const visibleOptions = getVisibleOptions();
        const selectedOption = getSelectedOption();

        const hasTooltip = ObjectUtils.isNotEmpty(props.tooltip);
        const otherProps = DropdownBase.getOtherProps(props);
        const ariaProps = ObjectUtils.reduceKeys(otherProps, DomHandler.ARIA_PROPS);
        const hiddenSelect = createHiddenSelect();
        const keyboardHelper = createKeyboardHelper();
        const labelElement = createLabel();
        const dropdownIcon = props.loading ? createLoadingIcon() : createDropdownIcon();
        const clearIcon = createClearIcon();
        const rootProps = mergeProps(
            {
                id: props.id,
                ref: elementRef,
                className: classNames(props.className, cx('root', { context, focusedState, overlayVisibleState })),
                style: props.style,
                onClick: (e) => onClick(e),
                onMouseDown: props.onMouseDown,
                onContextMenu: props.onContextMenu,
                onFocus: onFocus,
                'data-p-disabled': props.disabled,
                'data-p-focus': focusedState,
                'aria-activedescendant': focusedState ? `dropdownItem_${focusedOptionIndex}` : undefined
            },
            otherProps,
            ptm('root')
        );

        const firstHiddenFocusableElementProps = mergeProps(
            {
                ref: firstHiddenFocusableElementOnOverlay,
                role: 'presentation',
                className: 'p-hidden-accessible p-hidden-focusable',
                tabIndex: '0',
                onFocus: onFirstHiddenFocus,
                'data-p-hidden-accessible': true,
                'data-p-hidden-focusable': true
            },
            ptm('hiddenFirstFocusableEl')
        );

        const lastHiddenFocusableElementProps = mergeProps(
            {
                ref: lastHiddenFocusableElementOnOverlay,
                role: 'presentation',
                className: 'p-hidden-accessible p-hidden-focusable',
                tabIndex: '0',
                onFocus: onLastHiddenFocus,
                'data-p-hidden-accessible': true,
                'data-p-hidden-focusable': true
            },
            ptm('hiddenLastFocusableEl')
        );

        return (
            <>
                <div {...rootProps}>
                    {keyboardHelper}
                    {hiddenSelect}
                    {labelElement}
                    {clearIcon}
                    {dropdownIcon}
                    <DropdownPanel
                        hostName="Dropdown"
                        ref={overlayRef}
                        visibleOptions={visibleOptions}
                        virtualScrollerRef={virtualScrollerRef}
                        {...props}
                        appendTo={appendTo}
                        cx={cx}
                        filterValue={filterValue}
                        focusedOptionIndex={focusedOptionIndex}
                        getOptionGroupChildren={getOptionGroupChildren}
                        getOptionGroupLabel={getOptionGroupLabel}
                        getOptionGroupRenderKey={getOptionGroupRenderKey}
                        getOptionLabel={getOptionLabel}
                        getOptionRenderKey={getOptionRenderKey}
                        getSelectedOptionIndex={getSelectedOptionIndex}
                        hasFilter={hasFilter}
                        in={overlayVisibleState}
                        isOptionDisabled={isOptionDisabled}
                        isSelected={isSelected}
                        onOverlayHide={hide}
                        onClick={onPanelClick}
                        onEnter={onOverlayEnter}
                        onEntered={onOverlayEntered}
                        onExit={onOverlayExit}
                        onExited={onOverlayExited}
                        onFilterClearIconClick={onFilterClearIconClick}
                        onFilterInputChange={onFilterInputChange}
                        onFilterInputKeyDown={onFilterInputKeyDown}
                        onOptionClick={onOptionClick}
                        onInputKeyDown={onInputKeyDown}
                        ptm={ptm}
                        resetFilter={resetFilter}
                        changeFocusedOptionIndex={changeFocusedOptionIndex}
                        firstFocusableElement={<span {...firstHiddenFocusableElementProps} />}
                        lastFocusableElement={<span {...lastHiddenFocusableElementProps} />}
                        sx={sx}
                    />
                </div>
                {hasTooltip && <Tooltip target={elementRef} content={props.tooltip} pt={ptm('tooltip')} {...props.tooltipOptions} />}
            </>
        );
    })
);

Dropdown.displayName = 'Dropdown';
