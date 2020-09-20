function wrap(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function unwrap(arr) {
  return arr.length <= 1 ? arr[0] : arr;
}

function arrayify(value) {
  return value == null
    ? []
    : typeof value !== "string" && typeof value[Symbol.iterator] === "function"
    ? Array.from(value)
    : [value];
}

function isIteratorLike(value) {
  return value != null && typeof value.next === "function";
}

function isPromiseLike(value) {
  return value != null && typeof value.then === "function";
}

class Element {
  constructor(tag, props) {
    this.tag = tag;
    this.props = props;

    this._node = undefined;
    this._children = undefined;
    this._ctx = undefined;

    // flags
    this._isMounted = false;
  }
}

export const Portal = Symbol.for("crank.Portal");

export const Fragment = "";

export function createElement(tag, props, ...children) {
  props = Object.assign({}, props);
  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }

  return new Element(tag, props);
}

function narrow(value) {
  if (typeof value === "boolean" || value == null) {
    return undefined;
  } else if (typeof value === "string" || value instanceof Element) {
    return value;
  } else if (typeof value[Symbol.iterator] === "function") {
    return createElement(Fragment, null, value);
  }

  return value.toString();
}

function normalize(values) {
  const values1 = [];
  let buffer;
  for (const value of values) {
    if (!value) {
      // pass
    } else if (typeof value === "string") {
      buffer = (buffer || "") + value;
    } else if (!Array.isArray(value)) {
      if (buffer) {
        values1.push(buffer);
        buffer = undefined;
      }

      values1.push(value);
    } else {
      for (const value1 of value) {
        if (!value1) {
          // pass
        } else if (typeof value1 === "string") {
          buffer = (buffer || "") + value1;
        } else {
          if (buffer) {
            values1.push(buffer);
            buffer = undefined;
          }

          values1.push(value1);
        }
      }
    }
  }

  if (buffer) {
    values1.push(buffer);
  }

  return values1;
}

function getValue(el) {
  if (el.tag === Portal) {
    return undefined;
  } else if (typeof el.tag !== "function" && el.tag !== Fragment) {
    return el._node;
  }

  return unwrap(getChildValues(el));
}

function getChildValues(el) {
  const values = [];
  for (const child of wrap(el._children)) {
    if (typeof child === "string") {
      values.push(child);
    } else if (typeof child !== "undefined") {
      values.push(getValue(child));
    }
  }

  return normalize(values);
}

export class Renderer {
  constructor() {
    this._cache = new WeakMap();
  }

  render(children, root) {
    let portal = this._cache.get(root);
    if (portal) {
      portal.props = {root, children};
    } else {
      portal = createElement(Portal, {root, children});
      this._cache.set(root, portal);
    }

    const result = update(this, portal, portal);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(() => getChildValues(portal));
    }

    return getChildValues(portal);
  }

  create(el) {
    return document.createElement(el.tag);
  }

  patch(el, node) {
    for (let [name, value] of Object.entries(el.props)) {
      if (name === "children") {
        continue;
      } else if (name === "class") {
        name = "className";
      }

      if (name in node) {
        node[name] = value;
      } else {
        node.setAttribute(name, value);
      }
    }
  }

  arrange(el, node, children) {
    let child = node.firstChild;
    for (const newChild of children) {
      if (child === newChild) {
        child = child.nextSibling;
      } else if (typeof newChild === "string") {
        if (child !== null && child.nodeType === Node.TEXT_NODE) {
          child.nodeValue = newChild;
          child = child.nextSibling;
        } else {
          node.insertBefore(document.createTextNode(newChild), child);
        }
      } else {
        node.insertBefore(newChild, child);
      }
    }

    while (child !== null) {
      const nextSibling = child.nextSibling;
      node.removeChild(child);
      child = child.nextSibling;
    }
  }
}

function diff(renderer, host, oldChild, newChild) {
  if (
    oldChild instanceof Element &&
    newChild instanceof Element &&
    oldChild.tag === newChild.tag
  ) {
    if (oldChild !== newChild) {
      oldChild.props = newChild.props;
      newChild = oldChild;
    }
  }

  let value;
  if (newChild instanceof Element) {
    value = update(renderer, host, newChild);
  } else {
    value = newChild;
  }

  return [newChild, value];
}

function update(renderer, host, el) {
  if (el._isMounted) {
    el = createElement(el, {...el.props});
  }

  if (typeof el.tag === "function") {
    if (!el._ctx) {
      el._ctx = new Context(renderer, host, el);
    }

    return updateCtx(el._ctx);
  } else if (el.tag !== Fragment) {
    host = el;
  }

  return updateChildren(renderer, host, el, el.props.children);
}

function updateChildren(renderer, host, el, newChildren) {
  const oldChildren = wrap(el._children);
  newChildren = arrayify(newChildren);
  const children = [];
  let values = [];
  const length = Math.max(oldChildren.length, newChildren.length);
  for (let i = 0; i < length; i++) {
    const oldChild = oldChildren[i];
    let newChild = narrow(newChildren[i]);
    const [child, value] = diff(renderer, host, oldChild, newChild);
    if (oldChild instanceof Element && child !== oldChild) {
      unmount(renderer, oldChild);
    }

    children.push(child);
    if (value) {
      values.push(value);
    }
  }

  el._children = unwrap(children);
  if (values.some((value) => isPromiseLike(value))) {
    values = Promise.all(values).finally(() => {
      for (const oldChild of oldChildren.slice(length)) {
        if (oldChild instanceof Element) {
          unmount(renderer, oldChild);
        }
      }
    });

    return values.then((values) => commit(renderer, el, normalize(values)));
  }

  for (const oldChild of oldChildren.slice(length)) {
    if (oldChild instanceof Element) {
      unmount(renderer, oldChild);
    }
  }

  return commit(renderer, el, normalize(values));
}

function commit(renderer, el, values) {
  if (typeof el.tag === "function") {
    return commitCtx(el._ctx, values);
  } else if (el.tag === Fragment) {
    return unwrap(values);
  } else if (el.tag === Portal) {
    renderer.arrange(el, el.props.root, values);
    return undefined;
  } else if (!el._node) {
    el._node = renderer.create(el);
  }

  renderer.patch(el, el._node);
  renderer.arrange(el, el._node, values);
  return el._node;
}

function unmount(renderer, el) {
  if (typeof el.tag === "function") {
    unmountCtx(el._ctx);
  }

  for (const child of wrap(el._children)) {
    if (child instanceof Element) {
      unmount(renderer, child);
    }
  }
}

class Context {
  constructor(renderer, host, el) {
    this._renderer = renderer;
    this._host = host;
    this._el = el;
    this._iter = undefined;
    this._schedules = new Set();

    // flags
    this._isUpdating = false;
    this._isIterating = false;
    this._isDone = false;
  }

  refresh() {
    return stepCtx(this);
  }

  schedule(callback) {
    this._schedules.add(callback);
  }

  *[Symbol.iterator]() {
    while (!this._isDone) {
      if (this._isIterating) {
        throw new Error("Context iterated twice without a yield");
      }

      this._isIterating = true;
      yield this._el.props;
    }
  }
}

function stepCtx(ctx) {
  let initial = !ctx._iter;
  if (ctx._isDone) {
    return getValue(ctx._el);
  } else if (initial) {
    const value = ctx._el.tag.call(ctx, ctx._el.props);
    if (isIteratorLike(value)) {
      ctx._iter = value;
    } else if (isPromiseLike(value)) {
      return Promise.resolve(value)
        .then((value) => updateCtxChildren(ctx, value));
    } else {
      return updateCtxChildren(ctx, value);
    }
  }

  const oldValue = initial ? undefined : getValue(ctx._el);
  const iteration = ctx._iter.next(oldValue);
  ctx._isIterating = false;
  if (iteration.done) {
    ctx._isDone = true;
  }

  return updateCtxChildren(ctx, iteration.value);
}

function updateCtx(ctx) {
  ctx._isUpdating = true;
  return stepCtx(ctx);
}

function updateCtxChildren(ctx, children) {
  return updateChildren(ctx._renderer, ctx._host, ctx._el, narrow(children));
}

function commitCtx(ctx, values) {
  if (!ctx._isUpdating) {
    ctx._renderer.arrange(
      ctx._host,
      ctx._host.tag === Portal ? ctx._host.props.root : ctx._host._node,
      getChildValues(ctx._host),
    );
  }

  const value = unwrap(values);
  const schedules = Array.from(ctx._schedules);
  ctx._schedules.clear();
  for (const schedule of schedules) {
    schedule(value);
  }

  ctx._isUpdating = false;
  return value;
}

function unmountCtx(ctx) {
  if (!ctx._isDone) {
    ctx._isDone = true;
    if (ctx._iterator && typeof ctx._iterator.return === "function") {
      ctx._iterator.return();
    }
  }
}
